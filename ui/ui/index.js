

window.addEventListener('DOMContentLoaded', () => {

const DEV_DONT_CONNECT = false
const DEV_SKIP_LOADING_SCREEN = false

const latency_options = {
    // quality, latency in seconds
    "low": 0.5,
    "medium": 1.0,
    "high": 1.5
}

let is_turned_on = false
let mouse_is_down = false
let mouse_pos = [0, 0]
let current_voice_name = "Fem 1"
let using_custom_voice = false
let custom_voice_path = ""
let current_pitch_scale = 1
let previous_quality = ""
let max_latency_time = 1
let last_input_volume = 1
let last_output_volume = 1
let last_voice = {
    "is_custom_voice": false,
    "voice": "",
    "pitch_scale": 0
}


let input_devices = { "devices": [], "current": 0 }
let output_devices = { "devices": [], "current": 0 }


document.addEventListener("mousedown", () => {
    mouse_is_down = true
})
document.addEventListener("mouseup", () => {
    mouse_is_down = false
})
document.addEventListener("mousemove", e => {
    mouse_pos = [e.clientX, e.clientY]
})

document.addEventListener("keydown", e => {
    if(e.key === "Escape"){
        if(!selection_menu.classList.contains("hide")) selection_menu.classList.add("hide")
        else if(!modal_bg.classList.contains("hide")) {
            modal_bg.classList.add("hide")
            input_menu.classList.add("hide")
            output_menu.classList.add("hide")
        }else if(!credits_menu.classList.contains("hide")) {
            credits_menu.classList.add("hide")
        }
    }
})

function remap(value, low1, high1, low2, high2){
    return low2 + (value - low1) * (high2 - low2) / (high1 - low1)
}
function remove_siblings(el){
    const list = el.parentNode.children
    let dummy_el_count = 0
    for(let i = 0; i < list.length; i++){
        if(list[i].classList.contains("dummy")) dummy_el_count += 1
    }
    while(list.length > dummy_el_count){
        for(let i = 0; i < list.length; i++){
            if(!list[i].classList.contains("dummy")){
                list[i].remove()
                i -= 1
            }
        }
    }
}
function new_from_dummy(dummy_el){
    let new_el = dummy_el.cloneNode(true)
    new_el.classList.remove("dummy")
    const parent = dummy_el.parentNode
    parent.appendChild(new_el)
    return new_el
}


async function wait_until_connected() {
    return new Promise((res) => {

        if(DEV_DONT_CONNECT === true){
            res()
            return
        }

        const inter = setInterval(() => {
            if(window.socket_is_connected === true) {
                clearInterval(inter)
                res()
            }
        }, 10)
    })
}





const loading_screen = document.getElementsByClassName("loading-screen")[0]
const loading_text = document.getElementsByClassName("ls-loading")[0]
const progress_bar = document.getElementsByClassName("ls-progress")[0]

let progress_interval = null;

function do_timed_progress(name, time){
    loading_text.textContent = name

    clearInterval(progress_interval)

    let progress_amt = 0
    progress_interval = setInterval(() => {
        progress_amt += 50/time
        set_slider_value(progress_bar, progress_amt)
        if(progress_amt >= 1.0){
            clearInterval(progress_interval)
        }
    }, 50)
}
function do_progress(name, percent){
    loading_text.textContent = name
    set_slider_value(progress_bar, percent)
}

async function init_ui() {
    await wait_until_connected()

    let last_load_name = ""

    if(DEV_SKIP_LOADING_SCREEN) {
        loading_screen.classList.add("hide")
        return
    } else {
        while(true){
            const loading_info = await window.socket_get("ui_loading_info")
            if(loading_info["is_loading"] === true) {
                const load_name = loading_info["name"]
                if(load_name !== last_load_name){
                    do_timed_progress(load_name, loading_info["duration"])
                    last_load_name = load_name
                }
            } else {
                do_timed_progress("Testing your GPU...", 5000)
                max_latency_time = await window.socket_get("get_max_latency_time")
                console.log("Max latency time: " + max_latency_time + "s")

                console.log("DONE")
                loading_screen.animate([
                    { opacity: "100%" },
                    { opacity: "0%" }
                ], { duration: 200 })
                setTimeout(() => {
                    loading_screen.classList.add("hide")
                }, 190)
                break
            }
        }
    }

    set_quality("high")

    return
}

init_ui()





const controls = document.getElementsByClassName("controls")[0]
const controls_enabled_block = document.getElementsByClassName("controls-enabled-block")[0]
const controls_enabled_warning = document.getElementsByClassName("controls-enabled-warning")[0]
const voice_control = document.getElementsByClassName("voice")[0]

const voice_option = document.getElementsByClassName("voice-option-voice")[0]
const pitch_option = document.getElementsByClassName("voice-option-pitch")[0]
const quality_option = document.getElementsByClassName("voice-option-quality")[0]

const voice_option_value = voice_option.querySelector(".voice-option-value span")
const voice_option_quality = document.getElementsByClassName("voice-option-quality")[0]
const voice_option_quality_latency = document.getElementsByClassName("voice-option-quality-latency")[0]

const toggle = document.getElementsByClassName("toggle")[0]
const toggle_btn = document.getElementsByClassName("toggle-btn")[0]
const toggle_title = document.getElementsByClassName("toggle-title")[0]
const toggle_subtitle = document.getElementsByClassName("toggle-subtitle")[0]
const toggle_arrow = document.getElementsByClassName("toggle-arrow")[0]
const toggle_knob = document.getElementsByClassName("toggle-btn-knob")[0]
const running_indication = document.getElementsByClassName("running-indication")[0]


function update_ui(){
    if(is_turned_on) {
        toggle_title.textContent = "Running"
        toggle.classList.remove("toggle-disabled")
        toggle_subtitle.classList.add("hide")
        toggle_arrow.classList.add("hide")
        toggle_knob.classList.add("toggle-btn-knob-on")
        running_indication.classList.remove("hide")
        voice_control.classList.add("controls-disabled")
        controls_enabled_block.classList.remove("hide")
        controls_enabled_warning.classList.add("hide")
    } else {
        toggle.classList.add("toggle-disabled")
        toggle_title.textContent = "Not running"
        toggle_subtitle.classList.remove("hide")
        toggle_arrow.classList.remove("hide")
        toggle_knob.classList.remove("toggle-btn-knob-on")
        running_indication.classList.add("hide")
        voice_control.classList.remove("controls-disabled")
        controls_enabled_block.classList.add("hide")
        controls_enabled_warning.classList.add("hide")
    }

    voice_option_value.textContent = current_voice_name
    if(current_voice_name.length > 12) {
        voice_option_value.classList.remove("long-text")
        voice_option_value.classList.add("longer-text")
        voice_option_value.textContent = current_voice_name.slice(0, 12) + "..."
    } else if(current_voice_name.length > 8) {
        voice_option_value.classList.remove("longer-text")
        voice_option_value.classList.add("long-text")
    } else {
        voice_option_value.classList.remove("long-text")
        voice_option_value.classList.remove("longer-text")
    }
}

toggle_btn.addEventListener("click", async () => {
    is_turned_on = !is_turned_on
    toggle_subtitle.classList.add("hide")
    toggle_arrow.classList.add("hide")
    toggle_title.textContent = "Starting, one moment!"
    await window.socket_set("set_voice_changer_running", is_turned_on)
    update_ui()
})

controls_enabled_block.addEventListener("mouseenter", () => {
    if(is_turned_on){
        controls_enabled_warning.classList.remove("hide")
    }
})
controls_enabled_block.addEventListener("mouseleave", () => {
    if(is_turned_on){
        controls_enabled_warning.classList.add("hide")
    }
})





const sliders = document.getElementsByClassName("slider")
function set_slider_value(slider, percent){
    const slider_min = parseFloat(slider.dataset.min)
    const slider_max = parseFloat(slider.dataset.max)

    if(percent > slider_max) percent = slider_max
    else if(percent < slider_min) percent = slider_min

    const perc = remap(percent, slider_min, slider_max, 0, 1)
    if(perc < 0.05 && slider.dataset.disableLowLimit !== "true") {
        slider.querySelector(".slider-body").style.width = `3%`
    }else{
        slider.querySelector(".slider-body").style.width = `${perc * 100}%`
    }
    const slider_value = slider.querySelector(".slider-value")
    if(slider_value) slider_value.textContent = `${Math.round(percent * 100)}%`

    return percent
}
function update_slider(slider){
    const slider_min = parseFloat(slider.dataset.min)
    const slider_max = parseFloat(slider.dataset.max)
    let slider_steps = 8
    if(slider.dataset.steps){
        slider_steps = parseInt(slider.dataset.steps)
    }

    const rect = slider.getBoundingClientRect()
    const width = rect.right - rect.left
    const diff_x = mouse_pos[0] - rect.left
    let perc = 0;
    if(slider_steps > -1) perc = remap(Math.round(diff_x / width * slider_steps) / slider_steps, 0, 1, slider_min, slider_max)
    else perc = remap(diff_x / width / slider_steps, 0, 1, slider_min, slider_max)

    const percent = set_slider_value(slider, perc)

    if(slider.custom_update) slider.custom_update(percent)
}
for(let i = 0; i < sliders.length; i++) {
    const slider = sliders[i]

    const slider_min = parseFloat(slider.dataset.min)
    const slider_max = parseFloat(slider.dataset.max)
    let default_value = slider_min + (slider_max - slider_min)/2
    if(slider.dataset.default) default_value = slider.dataset.default
    set_slider_value(slider, default_value)

    slider.addEventListener("mousedown", () => {
        update_slider(slider)
    })
    slider.addEventListener("mousemove", () => {
        if(mouse_is_down) update_slider(slider)
    })
}

function round_to_nearest(value, step) {
    step || (step = 1.0);
    var inv = 1.0 / step;
    return Math.round(value * inv) / inv;
}

function cap_first(string) {
    return string.charAt(0).toUpperCase() + string.slice(1)
}

function set_quality(quality) {
    quality = quality.toLowerCase()

    if(quality !== previous_quality) {
        previous_quality = quality

        let latency = latency_options[quality]
        
        voice_option_quality.querySelector(".voice-option-value").textContent = cap_first(quality)
        
        let estimated_latency = round_to_nearest(latency + max_latency_time, 0.25)
        voice_option_quality_latency.querySelector("div").textContent = "Estimated Latency: About " + estimated_latency + "s"

        window.socket_set("set_latency", latency)
    }
}



const pitch_slider = pitch_option.querySelector(".slider")
pitch_slider.custom_update = async (v) => {
    document.getElementsByClassName("voice-option-pitch")[0].querySelector(".voice-option-value").textContent = v + "x"
    
    current_pitch_scale = v
    if(using_custom_voice) await set_voice(custom_voice_path, true, current_pitch_scale)
    else await set_voice(current_voice_name, false, current_pitch_scale)
}
const quality_slider = quality_option.querySelector(".slider")
quality_slider.custom_update = v => {
    const qualities = Object.keys(latency_options)
    let quality = qualities[parseInt(v * (qualities.length - 1))]
    set_quality(quality)
}

pitch_option.addEventListener("mousedown", () => {
    update_slider(pitch_slider)
})
pitch_option.addEventListener("mousemove", () => {
    if(mouse_is_down){
        update_slider(pitch_slider)
    }
})
quality_option.addEventListener("mousedown", () => {
    update_slider(quality_slider)
})
quality_option.addEventListener("mousemove", () => {
    if(mouse_is_down){
        update_slider(quality_slider)
    }
})

const input_threshold_slider = document.getElementsByClassName("input-threshold-slider")[0]
input_threshold_slider.custom_update = v => {
    window.socket_set("set_input_threshold", v * 0.03)
}


function unset_custom_voice(){
    using_custom_voice = false
    custom_voice_path = ""
    current_voice_name = "Fem 1"
    sm_custom_unset.classList.remove("hide")
    sm_custom_set.classList.add("hide")
    update_ui()
}
function play_voice_set_anim(){
    voice_option.animate([
        { scale: "1" },
        { scale: "1.12" },
        { scale: "1.0666" },
        { scale: "1.0333" },
        { scale: "1" }
    ], { duration: 60 })
}



async function set_voice(voice, is_custom_voice, pitch_scale){
    let voice_data = {
        "is_custom_voice": is_custom_voice,
        "voice": voice,
        "pitch_scale": pitch_scale
    }

    if(voice_data["voice"] !== last_voice["voice"] || voice_data["pitch_scale"] !== last_voice["pitch_scale"]){
        await window.socket_set("set_voice", voice_data)
    }
}


const selection_menu = document.getElementsByClassName("selection-menu")[0]
const sm_exit_btn = document.getElementsByClassName("sm-exit")[0]
const sm_items = document.getElementsByClassName("sm-item")
const sm_custom_unset = document.getElementsByClassName("sm-custom-unset")[0]
const sm_custom_set = document.getElementsByClassName("sm-custom-set")[0]
const sm_custom_btns = document.getElementsByClassName("sm-custom-btn")
const sm_custom_btn_set = document.getElementsByClassName("sm-custom-btn-set")[0]
const sm_error = document.getElementsByClassName("sm-error")[0]
const sm_custom_exit_btn = document.getElementsByClassName("sm-custom-exit")[0]

voice_option.addEventListener("click", () => {
    selection_menu.classList.remove("hide")
})
sm_exit_btn.addEventListener("click", () => {
    selection_menu.classList.add("hide")
})

for(let i = 0; i < sm_items.length; i++){
    const sm_item = sm_items[i]

    sm_item.addEventListener("click", async () => {
        unset_custom_voice()
        current_voice_name = sm_item.textContent
        update_ui()

        await set_voice(current_voice_name, false, current_pitch_scale)
        selection_menu.classList.add("hide")
        play_voice_set_anim()

        // await window.socket_set("set_voice", {
        //     "is_custom_voice": false,
        //     "voice": current_voice_name,
        //     "pitch_scale": pitchg1/0!!4125/320
        // })

        // selection_menu.classList.add("hide")
        // play_voice_set_anim()
    })
}

sm_custom_exit_btn.addEventListener("click", () => {
    unset_custom_voice()
})

for(let i = 0; i < sm_custom_btns.length; i++){
    const sm_custom_btn = sm_custom_btns[i]
    
    sm_custom_btn.addEventListener("click", async () => {
        const file_paths = await window.electron_api.open_dialog()
        if(file_paths !== -1) {
            const file_path = file_paths[0]
            if(file_path.endsWith(".wav")) {
                let file_name = file_path.replace(/^.*[\\\/]/, '')
                using_custom_voice = true
                custom_voice_path = file_path
                current_voice_name = file_name
                if(file_name.length > 20) file_name = file_name.slice(0, 20) + "..."
                sm_custom_btn_set.querySelector(".sm-custom-btn-inner").textContent = file_name

                await set_voice(file_path, true, current_pitch_scale)

                sm_custom_unset.classList.add("hide")
                sm_custom_set.classList.remove("hide")
                update_ui()
                selection_menu.classList.add("hide")
                play_voice_set_anim()
            } else {
                sm_error.textContent = "Voice clip must be a .wav audio file."
                sm_error.classList.remove("hide")
                sm_error.animate([
                    { opacity: "100%" },
                    { opacity: "100%" },
                    { opacity: "100%" },
                    { opacity: "100%" },
                    { opacity: "0%" }
                ], { duration: 3500 })
                setTimeout(() => {
                    sm_error.classList.add("hide")
                }, 3480)
            }
        }
    })
}


const side_control_circles = document.querySelectorAll(".side-control .side-control-circle")
const side_controls = document.querySelectorAll(".side-control")

for(let i = 0; i < side_controls.length; i++){
    const side_control = side_controls[i]
    const side_control_circle = side_control_circles[i]

    side_control_circle.addEventListener("mouseenter", e => {
        if(e.target !== side_control_circle) return
        side_control.querySelector(".side-control-text").classList.remove("hide")
    })
    side_control_circle.addEventListener("mouseleave", e => {
        if(e.target !== side_control_circle) return
        side_control.querySelector(".side-control-text").classList.add("hide")
    })
}

const input_control_circle = document.querySelector(".input-control .side-control-circle")
const output_control_circle  = document.querySelector(".output-control .side-control-circle")
const modal_bg = document.getElementsByClassName("modal-bg")[0]
const input_menu = document.getElementsByClassName("input-menu")[0]
const output_menu = document.getElementsByClassName("output-menu")[0]
const input_menu_exit_btn = document.querySelector(".input-menu .modal-exit")
const input_menu_done_btn = document.querySelector(".input-menu .im-done-btn")
const output_menu_exit_btn = document.querySelector(".output-menu .modal-exit")
const output_menu_done_btn = document.querySelector(".output-menu .im-done-btn")

const input_device_dummy_el = document.querySelector(".input-menu .im-device.dummy")
const output_device_dummy_el = document.querySelector(".output-menu .im-device.dummy")

function update_input_menu(input_devices){
    remove_siblings(input_device_dummy_el)
    
    let devices_shown = []
    for(let i = 0; i < input_devices["devices"].length; i++){
        const device_name = input_devices["devices"][i]

        if(devices_shown.includes(device_name)) continue

        let im_device_el = new_from_dummy(input_device_dummy_el)
        im_device_el.textContent = device_name

        if(input_devices["current"] == i) {
            im_device_el.classList.add("im-selected")
        }

        im_device_el.addEventListener("click", () => {
            input_devices["current"] = i
            window.socket_set("set_current_input", i)
            update_input_menu(input_devices)
        })

        devices_shown.push(device_name)
    }
}
function update_output_menu(output_devices){
    remove_siblings(output_device_dummy_el)
    
    let devices_shown = []
    for(let i = 0; i < output_devices["devices"].length; i++){
        const device_name = output_devices["devices"][i]

        if(devices_shown.includes(device_name)) continue

        let im_device_el = new_from_dummy(output_device_dummy_el)
        im_device_el.textContent = device_name

        if(output_devices["current"] == i) {
            im_device_el.classList.add("im-selected")
        }

        im_device_el.addEventListener("click", () => {
            output_devices["current"] = i
            window.socket_set("set_current_output", i)
            update_output_menu(output_devices)
        })

        devices_shown.push(device_name)
    }
}

input_control_circle.addEventListener("click", async () => {
    modal_bg.classList.remove("hide")
    input_menu.classList.remove("hide")

    const input_devices = await window.socket_get("get_input_list")
    update_input_menu(input_devices)
})
output_control_circle.addEventListener("click", async () => {
    modal_bg.classList.remove("hide")
    output_menu.classList.remove("hide")

    const output_devices = await window.socket_get("get_output_list")
    console.log("hh")
    console.log(output_devices)
    update_output_menu(output_devices)
})
input_menu_exit_btn.addEventListener("click", () => {
    modal_bg.classList.add("hide")
    input_menu.classList.add("hide")
})
input_menu_done_btn.addEventListener("click", () => {
    modal_bg.classList.add("hide")
    input_menu.classList.add("hide")
})
output_menu_exit_btn.addEventListener("click", () => {
    modal_bg.classList.add("hide")
    output_menu.classList.add("hide")
})
output_menu_done_btn.addEventListener("click", () => {
    modal_bg.classList.add("hide")
    output_menu.classList.add("hide")
})


async function set_voice(voice, is_custom_voice, pitch_scale){
    let voice_data = {
        "is_custom_voice": is_custom_voice,
        "voice": voice,
        "pitch_scale": pitch_scale
    }

    if(voice_data["voice"] !== last_voice["voice"] || voice_data["pitch_scale"] !== last_voice["pitch_scale"]){
        await window.socket_set("set_voice", voice_data)
    }
}


const input_volume_slider = document.getElementsByClassName("input-volume-slider")[0]
const output_volume_slider = document.getElementsByClassName("output-volume-slider")[0]

input_volume_slider.custom_update = v => {
    if(v !== last_input_volume) {
        last_input_volume = v
        window.socket_set("set_input_volume", v)
    }
}
output_volume_slider.custom_update = v => {
    if(v !== last_output_volume) {
        last_output_volume = v
        window.socket_set("set_output_volume", v)
    }
}


const credits_btn = document.getElementsByClassName("credits-btn")[0]
const credits_menu = document.getElementsByClassName("credits-menu")[0]
const credits_exit = document.getElementsByClassName("cm-exit")[0]

credits_btn.addEventListener("click", () => {
    credits_menu.classList.remove("hide")
})
credits_exit.addEventListener("click", () => {
    credits_menu.classList.add("hide")
})


const fatal_error_modal = document.getElementsByClassName("fatal-error")[0]
const fatal_error_msg = document.getElementsByClassName("fe-error-msg")[0]
setInterval(() => {
    if(window.fatal_error_occurred === true){
        fatal_error_msg.innerHTML = window.fatal_error.replaceAll("\n", "<br>")
        fatal_error_modal.classList.remove("hide")
        modal_bg.classList.remove("hide")
    }
}, 500)




update_ui()

})