import os
import subprocess
import requests
import shutil
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

class ProcessRequest(BaseModel):
    job_id: str
    youtube_url: str
    callback_url: str
    stem_count: Optional[int] = 4  # Recebe a escolha, padrão é 4

def process_audio(job_id: str, youtube_url: str, callback_url: str, stem_count: int):
    job_dir = os.path.abspath(f"./public/{job_id}")
    raw_audio = os.path.join(job_dir, "input.wav")
    
    try:
        os.makedirs(job_dir, exist_ok=True)
        requests.post(callback_url, json={"job_id": job_id, "status": "A transferir áudio...", "progress": 20})
        
        subprocess.run(["yt-dlp", "--no-playlist", "-x", "--audio-format", "wav", "-o", raw_audio, youtube_url], check=True)
        requests.post(callback_url, json={"job_id": job_id, "status": f"A separar em {stem_count} faixas (pode demorar)...", "progress": 50})
        
        # Define o modelo e as faixas consoante a escolha do utilizador
        if stem_count == 6:
            model_name = "htdemucs_6s"
            stem_names = ["vocals", "drums", "bass", "other", "piano", "guitar"]
        else:
            model_name = "htdemucs"
            stem_names = ["vocals", "drums", "bass", "other"]

        # Roda o Demucs com o modelo dinâmico
        subprocess.run(["demucs", "-n", model_name, "-o", "./stems", raw_audio], check=True)
        
        demucs_out = f"./stems/{model_name}/input"
        stems_urls = {}
        
        for stem in stem_names:
            src = os.path.join(demucs_out, f"{stem}.wav")
            dst = os.path.join(job_dir, f"{stem}.wav")
            if os.path.exists(src):
                shutil.copy(src, dst)
                stems_urls[stem] = f"/static/{job_id}/{stem}.wav"
                
        requests.post(callback_url, json={
            "job_id": job_id, 
            "status": "Concluído!", 
            "progress": 100, 
            "stems": stems_urls
        })

    except Exception as e:
        requests.post(callback_url, json={"job_id": job_id, "status": "Erro", "error": str(e)})

@app.post("/process")
def start_process(req: ProcessRequest, bg_tasks: BackgroundTasks):
    bg_tasks.add_task(process_audio, req.job_id, req.youtube_url, req.callback_url, req.stem_count)
    return {"message": "Processo iniciado!"}