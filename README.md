# Free Voice Changer
A free voice changer powered by [FreeVC voice conversion](https://github.com/OlaWod/FreeVC)

This app was only tested on Windows with an nvidia gpu, but should work on an amd gpu as well

## Demo Video

https://www.youtube.com/watch?v=mm-Rig7dPr8

## Installation
1. Have python installed (tested on python version 3.9.10)

2. Have nodejs installed

3. Clone this repo `https://github.com/SarahStuff/Free_Voice_Changer.git`

4. CD into this repo `cd Free_Voice_Changer`

5. Install python requirements `pip install -r requirements.txt`

6. Install nodejs requirements `npm install` (run this in the 'ui' directory)

7. Download the freevc.pth model from [here](https://1drv.ms/u/s!AnvukVnlQ3ZTx1rjrOZ2abCwuBAh?e=UlhRR5) and put it in under the directory 'FreeVC/checkpoints/'

8. Download the WavLM-Large model and from [here](https://github.com/microsoft/unilm/tree/master/wavlm) and put it under the directory 'FreeVC/wavlm/'

## Running the app

Run `python FreeVoiceChanger.py` to start the app

Sometimes the app is buggy, restart the app first if you encounter any issues like abnormally long latency times, that usually fixes the problem

Make sure your input and output devices are correct by clicking on the microphone icon or the speaker icon and selecting your device

## Note

The FreeVC directory is just the [FreeVC repository](https://github.com/OlaWod/FreeVC) but I removed any unnecessary files
