
window.socket = new WebSocket("ws://localhost:38926");
window.socket_is_connected = false
window.fatal_error_occurred = false
window.fatal_error = ""

console.log("Connecting to server...")

window.socket.addEventListener("open", e => {
    window.socket_is_connected = true
    console.log("Connected successfully!")
});

window.socket.addEventListener("error", e => {
    window.socket_is_connected = false
    console.log("Connection error.")
});

let wait_to_receive_arr = {}

window.socket.addEventListener("message", e => {
    console.log("Received: ", e.data)

    let idx = e.data.indexOf(':')

    const type = e.data.substring(0, idx)
    const data = JSON.parse(e.data.substring(idx+1))

    if(type === "fatal_error"){
        window.fatal_error_occurred = true
        window.fatal_error = data
    }

    wait_to_receive_arr[type] = data
});

window.socket_get = async function(type){
    socket.send(type)
    wait_to_receive_arr[type] = undefined

    return new Promise((res) => {

        const inter = setInterval(() => {
            const data = wait_to_receive_arr[type]
            if(data !== undefined) {
                clearInterval(inter)
                res(data)
            }
        }, 10)
    })
}

window.socket_set = async function(type, data){
    socket.send(`${type}:${JSON.stringify(data)}`)
    wait_to_receive_arr[type] = undefined

    return new Promise((res) => {

        const inter = setInterval(() => {
            const data = wait_to_receive_arr[type]
            if(data !== undefined) {
                clearInterval(inter)
                res(data)
            }
        }, 10)
    })
}
