import sys
import os
import wave
import contextlib
import speech_recognition as sr  # type: ignore
import json

def get_wav_duration(path):
    try:
        with contextlib.closing(wave.open(path, 'r')) as f:
            frames = f.getnframes()
            rate = f.getframerate()
            duration = frames / float(rate)
            return round(duration, 2)
    except:
        return 0

def transcribe_audio(audio_file):
    recognizer = sr.Recognizer()

    duration = get_wav_duration(audio_file)
    print(f"Audio Duration: {duration} seconds")

    if duration < 1.0:
        print("Audio too short for transcription.")
        result = {
            "duration": duration,
            "transcription": "",
            "error": "Audio too short for transcription"
        }
        print(json.dumps(result))
        return

    try:
        with sr.AudioFile(audio_file) as source:
            audio_data = recognizer.record(source)
            text = recognizer.recognize_google(audio_data)
            print(f"Transcription: {text}")
            result = {
                "duration": duration,
                "transcription": text,
                "error": None
            }
            print(json.dumps(result))
    except sr.UnknownValueError:
        print("Could not understand audio.")
        result = {
            "duration": duration,
            "transcription": "",
            "error": "Could not understand audio"
        }
        print(json.dumps(result))
    except sr.RequestError as e:
        print(f"Google Speech Recognition API error: {e}")
        result = {
            "duration": duration,
            "transcription": "",
            "error": f"Google Speech Recognition API error: {e}"
        }
        print(json.dumps(result))
    except Exception as e:
        print(f"Error processing audio: {e}")
        result = {
            "duration": duration,
            "transcription": "",
            "error": f"Error processing audio: {e}"
        }
        print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <audio_wav_file>")
        sys.exit(1)

    audio_path = sys.argv[1]

    if not os.path.exists(audio_path):
        print("ERROR: Audio file does not exist.")
        sys.exit(1)

    if not audio_path.lower().endswith(".wav"):
        print("ERROR: Only WAV files are supported.")
        sys.exit(1)

    transcribe_audio(audio_path)
