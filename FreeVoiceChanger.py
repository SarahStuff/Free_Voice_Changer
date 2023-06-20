

# Formats an exception and returns a formatted version of it with a stack trace
def format_exception(e):
    exception_list = traceback.format_stack()
    exception_list = exception_list[:-2]
    exception_list.extend(traceback.format_tb(sys.exc_info()[2]))
    exception_list.extend(traceback.format_exception_only(sys.exc_info()[0], sys.exc_info()[1]))

    exception_str = "Traceback (most recent call last):\n"
    exception_str += "".join(exception_list)
    # Removing the last \n
    exception_str = exception_str[:-1]

    return exception_str

# Converts source wav with current voice target and writes to output_wav_path
def convert(source_wav_path, output_wav_path):
    global out_dir, dml

    start_time = time.time()

    print("Synthesizing...")
    with torch.no_grad():
        wav_src, _ = librosa.load(source_wav_path, sr=hps.data.sampling_rate)
        wav_src = torch.from_numpy(wav_src).unsqueeze(0).to(dml)#.cuda()
        c = utils.get_content(cmodel, wav_src)
        
        if hps.model.use_spk:
            audio = net_g.infer(c, g=g_tgt)
        else:
            audio = net_g.infer(c, mel=mel_tgt)
        audio = audio[0][0].data.cpu().float().numpy()
        
        write(output_wav_path, hps.data.sampling_rate, audio)
        
    t = time.time() - start_time
    print("Time: " + str(round(t, 3)) + "s")

    return t

def write_audio(audio):
    out_stream.write(audio)

# Converts source wav with current voice target and queues it to be played to the output device, then deletes the source wav
def convert_and_play(source_wav_path, samples_from_last_to_keep=-1, iteration=-1):
    global input_threshold, min_conversion_time, out_dir, prev_audio, dml, wav_queue

    start_time = time.time()

    print("Synthesizing...")
    with torch.no_grad():
        wav_src, _ = librosa.load(source_wav_path, sr=hps.data.sampling_rate)
        wav_src = torch.from_numpy(wav_src).unsqueeze(0).to(dml)#.cuda()
        c = utils.get_content(cmodel, wav_src)
        
        if hps.model.use_spk:
            audio = net_g.infer(c, g=g_tgt)
        else:
            audio = net_g.infer(c, mel=mel_tgt)
        audio = audio[0][0].data.cpu().float().numpy()
        
        if not samples_from_last_to_keep == -1:
            if len(audio) > samples_from_last_to_keep:
                audio = audio[-samples_from_last_to_keep:]
    
    os.remove(source_wav_path)
    # sf.write(source_wav_path, audio, 16000)
    
    t = time.time() - start_time
    print("Time: " + str(round(t, 3)) + "s")
    
    wave_raw = (audio, 16000, iteration)

    time_to_wait_before_playing = max_conversion_time - t
    if time_to_wait_before_playing > 0:
        time.sleep(time_to_wait_before_playing)

    print(f"Appending to queue: {iteration} ({max(0, time_to_wait_before_playing) + t} total)")
    # wav_queue.append(wave_raw)
    threading.Thread(target=write_audio, args=(audio,)).start()

    return t

# Generator that yields blocks of input data as NumPy arrays.
async def inputstream_generator():
    q_in = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def callback(indata, frame_count, time_info, status):
        loop.call_soon_threadsafe(q_in.put_nowait, (indata.copy(), status))

    stream = sd.InputStream(samplerate=16000, channels=1, dtype='int16', blocksize=blocksize, callback=callback)
    with stream:
        while True:
            indata, status = await q_in.get()
            
            yield indata, status, time.time()

# Continuously processes and converts the input audio, and manages the previous audio history, and queues it to be played to the output device
async def start_processing_audio_buffer():
    global input_volume, audio_processing_started, stop_everything, voice_changer_is_running, global_ndarray, iteration, log, prev_audio, history_blocksize_seconds

    audio_processing_started = False

    try:
        last_indata_transformed = np.array([])
        last_conversion_time = 0
        
        async for indata, status, time_of_current_segment in inputstream_generator():
            audio_processing_started = True

            print(f"Beginning process loop: {iteration}")

            if stop_everything:
                return
            
            indata_flattened = abs(indata.flatten())

            
            if (global_ndarray is not None):
                global_ndarray = np.concatenate((global_ndarray, indata), dtype='int16')
            else:
                global_ndarray = indata
            
        
            local_ndarray = global_ndarray.copy()
            global_ndarray = None
            indata_transformed = local_ndarray.flatten().astype(np.float32) / 32768.0
            
            # prepend last block to indata
            original_indata_transformed = indata_transformed
            if not last_indata_transformed.size == 0:
                indata_transformed = np.concatenate((last_indata_transformed, indata_transformed))

            if np.max(indata_flattened) > input_threshold:
                wav_path = os.path.join(directory, "seg_" + str(iteration) + ".wav")
                sf.write(wav_path, indata_transformed * input_volume, 16000)
                convert_and_play(wav_path, blocksize, iteration)
            else:
                print("Not playing block, too quiet.")
            
            last_indata_transformed = np.concatenate((last_indata_transformed, original_indata_transformed))
            iteration += 1
                
            last_indata_diff = last_indata_transformed.size - (blocksize + history_blocksize)
            if last_indata_diff > 0:
                print("SHAVING LAST AUDIO HISTORY!")
                last_indata_transformed = last_indata_transformed[last_indata_diff:]
                
            try:
                del local_ndarray
            except:
                pass
            del indata_flattened
    except Exception as e:
        e = format_exception(e)
        print(e)
        server.send_message_to_all(f"fatal_error:{json.dumps(e)}")

# Writes wave data to output device
def out_stream_write(wave_data):
    global output_volume, out_stream, open_out_stream_threads
    print("OUT STREAM THREADS: " + str(open_out_stream_threads))

    for i in range(len(wave_data)):
        wave_data[i] = wave_data[i] * output_volume * 2

    out_stream.write(wave_data)
    open_out_stream_threads -= 1

# Continuously plays audio from the wave queue one at a time
def start_out_stream():
    global max_conversion_time, out_stream, open_out_stream_threads, stop_everything

    try:
        out_stream = sd.OutputStream(samplerate=16000,
                                    channels=1,
                                    dtype="float32",
                                    blocksize=1024)
        out_stream.start()
    
        open_out_stream_threads = 0
        while True:
            if stop_everything:
                break

            # if len(wav_queue) > 0:
                # wave_raw = wav_queue[0]
                # wave_data, samplerate, iteration = wave_raw
                # wav_queue.pop(0)

                # print(f"Pushing to out stream: {iteration}")
                # open_out_stream_threads += 1
                # threading.Thread(target=out_stream_write, args=(wave_data,)).start()

            time.sleep(0.000001)
            
        out_stream.close()
    except Exception as e:
        e = format_exception(e)
        print(e)
        server.send_message_to_all(f"fatal_error:{json.dumps(e)}")
        
        

# Websocket server stuff
def new_client(client, server):
    print("New client!")

def client_left(client, server):
    global stop_everything
    print("Lost a client!")
    stop_everything = True # Lost connection to UI, so stop everything
    print("STOPPING!")

def start_server():
    global server
    print("Server starting...")
    server.run_forever(True)

def send_data():
    global server, ui_loading_info, is_loading, stop_everything
    while True:
        if stop_everything:
            print("Server force shutdown!")
            server.shutdown_abruptly()
            break

        if is_loading:
            server.send_message_to_all(f"ui_loading_info:{json.dumps(ui_loading_info)}")
            if ui_loading_info["is_loading"] == False:
                is_loading = False
        time.sleep(0.001)

# Websocket server function that handles incoming data from the ui client
def get_data(client, server, msg):
    global input_volume, output_volume, input_threshold, audio_processing_started, min_conversion_time, max_conversion_time, audio_process_task, voice_changer_is_running

    try:

        type = ""
        data = ""

        if ":" in msg:
            type, data = msg.split(":", 1)
            data = json.loads(data)
        else:
            type = msg

        if type == "get_input_list":
            devices = sd.query_devices()
            input_devices = []
            
            for device in devices:
                device_name = device['name']
                if device['max_input_channels'] > 0 and device['hostapi'] == 1 and not device_name in input_devices:
                    input_devices.append(device_name)
            server.send_message_to_all("get_input_list:" + json.dumps({ "devices": input_devices, "current": sd.default.device[0]}))
        elif type == "set_current_input":
            sd.default.device[0] = data
            server.send_message_to_all("set_current_input:" + json.dumps(True))

        elif type == "get_output_list":
            devices = sd.query_devices()
            output_devices = []
            
            for device in devices:
                device_name = device['name']
                if device['max_output_channels'] > 0 and device['hostapi'] == 1 and not device_name in output_devices:
                    output_devices.append(device_name)
            server.send_message_to_all("get_output_list:" + json.dumps({ "devices": output_devices, "current": sd.default.device[1]}))
        elif type == "set_current_output":
            sd.default.device[1] = data
            server.send_message_to_all("set_current_output:" + json.dumps(True))

        elif type == "set_input_volume":
            input_volume = data
            print("in" + str(data))
            server.send_message_to_all("set_input_volume:" + json.dumps(True))

        elif type == "set_output_volume":
            output_volume = data
            print("out" + str(data))
            server.send_message_to_all("set_output_volume:" + json.dumps(True))

        elif type == "set_voice":
            if data["is_custom_voice"] == False:
                voice_category, voice_num = data["voice"].split(" ")
                load_target_voice(f"voices/{voice_category.lower()}/{voice_num}.wav", data["pitch_scale"])
            else:
                voice_path = data["voice"]
                load_target_voice(voice_path, data["pitch_scale"])
            server.send_message_to_all("set_voice:" + json.dumps(True))

        elif type == "set_voice_changer_running":
            voice_changer_is_running = data
            while True:
                if audio_processing_started:
                    break
                time.sleep(0.0001)
            server.send_message_to_all("set_voice_changer_running:" + json.dumps(True))

        elif type == "set_input_threshold":
            input_threshold = data
            server.send_message_to_all("set_input_threshold:" + json.dumps(True))

        elif type == "set_latency":
            print(data)
            set_latency(data)
            server.send_message_to_all("set_quality:" + json.dumps(True))

        elif type == "get_max_latency_time":
            highest_time = -1
            lowest_time = 999
            for i in range(5):
                t = convert(f"{directory}test_{i}.wav", f"{directory}test_out.wav")
                if t > highest_time:
                    highest_time = t
                if t < lowest_time:
                    lowest_time = t

            min_conversion_time = lowest_time
            max_conversion_time = highest_time + 0.12 # + 0.12 to account for when it takes unexpectly longer sometimes
            server.send_message_to_all("get_max_latency_time:" + json.dumps(max_conversion_time))
    except Exception as e:
        e = format_exception(e)
        print(e)
        server.send_message_to_all(f"fatal_error:{json.dumps(e)}")



# Loads a new target voice clip
def load_target_voice(target_wav_path, pitch_scale=1):
    global wav_tgt, g_tgt, hps, smodel, mel_tgt, dml

    # Load target wav
    wav_tgt, _ = librosa.load(target_wav_path, sr=hps.data.sampling_rate * (1 / pitch_scale))
    wav_tgt, _ = librosa.effects.trim(wav_tgt, top_db=20)
    if hps.model.use_spk:
        g_tgt = smodel.embed_utterance(wav_tgt)
        g_tgt = torch.from_numpy(g_tgt).unsqueeze(0).to(dml)#.cuda()
    else:
        wav_tgt = torch.from_numpy(wav_tgt).unsqueeze(0).to(dml)#.cuda()
        mel_tgt = mel_spectrogram_torch(
            wav_tgt, 
            hps.data.filter_length,
            hps.data.n_mel_channels,
            hps.data.sampling_rate,
            hps.data.hop_length,
            hps.data.win_length,
            hps.data.mel_fmin,
            hps.data.mel_fmax
        )
        

# Sets a new latency setting for the voice conversion
def set_latency(seconds):
    global history_blocksize, blocksize, blocksize_seconds

    history_blocksize_seconds = 2
    blocksize_seconds = seconds

    history_blocksize = int(round(16000 * history_blocksize_seconds))
    blocksize = int(round(16000 * blocksize_seconds))

    print(f"Latency changed to: {str(blocksize_seconds)}s")
    print("History Blocksize: " + str(history_blocksize))
    print("Blocksize: " + str(blocksize))


# Main function that is run
async def main():
    global input_volume, output_volume, input_threshold, audio_processing_started, min_conversion_time, max_conversion_time, audio_process_task, stop_everything, dml, voice_changer_is_running, server, is_loading, ui_loading_info, blocksize, blocksize_seconds, history_blocksize, SILENCE_THRESHOLD, prev_audio, global_ndarray, iteration, wav_queue, hp_file, pt_file, target_wav_path, directory, wav_tgt, mel_tgt, pyaud, g_tgt, input_volume_mod, output_volume_mod, output_pitch_mod, hps, smodel, net_g, cmodel
    global torch, librosa, write, tqdm, np, sd, sf, utils, SynthesizerTrn, mel_spectrogram_torch, WavLM, WavLMConfig, SpeakerEncoder, logging

    try:
        stop_everything = False
        voice_changer_is_running = False
        audio_processing_started = False

        min_conversion_time = 0
        max_conversion_time = 0

        output_volume = 1
        input_volume = 1

        server = WebsocketServer(host='127.0.0.1', port=38926)
        server.set_fn_new_client(new_client)
        server.set_fn_client_left(client_left)
        server.set_fn_message_received(get_data)

        is_loading = True
        ui_loading_info = { "is_loading": True, "name": "Setting up...", "duration": 3000 }

        start_server()
        threading.Thread(target=send_data).start()
            
        print("Starting UI...")
        electron_ui_process = subprocess.Popen(["npm", "start", "--prefix", "ui"], shell=True)

        if stop_everything:
            return

        import torch
        import torch_directml
        import librosa
        from scipy.io.wavfile import write
        from tqdm import tqdm
        import numpy as np

        dml = torch_directml.device()
        
        if stop_everything:
            return

        ui_loading_info = { "is_loading": True, "name": "Initializing audio...", "duration": 3000 }

        import sounddevice as sd
        import soundfile as sf
        
        if stop_everything:
            return

        ui_loading_info = { "is_loading": True, "name": "Initializing AI models...", "duration": 4000 }
        
        import FreeVC.utils as utils
        from FreeVC.models import SynthesizerTrn
        from FreeVC.mel_processing import mel_spectrogram_torch
        from FreeVC.wavlm import WavLM, WavLMConfig
        from FreeVC.speaker_encoder.voice_encoder import SpeakerEncoder
        import logging
        logging.getLogger('numba').setLevel(logging.WARNING)

        if stop_everything:
            return

        set_latency(1.5)
        
        input_threshold = 0.015

        global_ndarray = None
        wav_queue = []
        iteration = 0

        hp_file = "FreeVC/configs/freevc.json"
        pt_file = "FreeVC/checkpoints/freevc.pth"
        directory = "test_audio/"
        
        hps = utils.get_hparams_from_file(hp_file)


        ui_loading_info = { "is_loading": True, "name": "Loading FreeVC AI model...", "duration": 3500 }

        print("Loading model...")
        # if low_memory_mode:
        #     hps.model.ssl_dim = 1030
        net_g = SynthesizerTrn(
            hps.data.filter_length // 2 + 1,
            hps.train.segment_size // hps.data.hop_length,
            **hps.model).to(dml)#.cuda()
        _ = net_g.eval()
        
        if stop_everything:
            return
        
        print("Loading checkpoint...")
        _ = utils.load_checkpoint(pt_file, net_g, None)


        if stop_everything:
            return

        ui_loading_info = { "is_loading": True, "name": "Loading WavLM AI model...", "duration": 10000 }

        print("Loading WavLM for content...")
        wavlm_path = "FreeVC/wavlm/WavLM-Large.pt"
        # if low_memory_mode:
        #     wavlm_path = "FreeVC/wavlm/WavLM-Base+.pt"
        cmodel = utils.get_cmodel(0, wavlm_path)

        if hps.model.use_spk:
            ui_loading_info = { "is_loading": True, "name": "Loading speaker encoder model...", "duration": 4000 }
            print("Loading speaker encoder...")
            smodel = SpeakerEncoder('FreeVC/speaker_encoder/ckpt/pretrained_bak_5805000.pt')
            


        load_target_voice("voices/fem/1.wav")
            
        print("Doing initialization conversion...")
        convert(f"{directory}INIT_in.wav", f"{directory}INIT_out.wav")
        print("\nReady!")
        
        threading.Thread(target=start_out_stream).start()
        
        ui_loading_info = { "is_loading": False, "name": "", "duration": 1 }

        last_running_toggle = False
        while True:
            if stop_everything:
                break

            if voice_changer_is_running != last_running_toggle:
                last_running_toggle = voice_changer_is_running
                print(voice_changer_is_running)
                if voice_changer_is_running:
                    print("start")
                    audio_process_task = asyncio.create_task(start_processing_audio_buffer())
                else:
                    audio_process_task.cancel()
                    audio_processing_started = False

            await asyncio.sleep(0.001)

    except Exception as e:
        e = format_exception(e)
        print(e)
        server.send_message_to_all(f"fatal_error:{json.dumps(e)}")
        




if __name__ == "__main__":
    try:
        import json
        from websocket_server import WebsocketServer
        import threading
        import traceback
        import time
        import os
        import subprocess
        import asyncio
        import sys

        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit('\nInterrupted by user')
            
