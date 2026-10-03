import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import WaveSurfer from 'wavesurfer.js';
import { 
  Play, Pause, Volume2, VolumeX, Music, Loader2, 
  CheckCircle2, Headphones, Rewind, FastForward 
} from 'lucide-react';

const socket = io('http://localhost:3001');

export default function App() {
  const [url, setUrl] = useState('');
  const [stemCount, setStemCount] = useState(4);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const eventName = `job_update:${jobId}`;
    socket.on(eventName, (data) => {
      setStatus(data.status);
      if (data.progress) setProgress(data.progress);
      if (data.stems) {
        setStems(data.stems);
        setLoading(false);
      }
      if (data.status.includes('Erro')) {
        setLoading(false);
        alert(`Ocorreu um erro: ${data.error}`);
      }
    });
    return () => socket.off(eventName);
  }, [jobId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setStatus('A enviar pedido...');
    setProgress(5);
    setStems(null);

    try {
      const response = await fetch('http://localhost:3001/api/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: url, stemCount })
      });
      const data = await response.json();
      setJobId(data.jobId);
    } catch (error) {
      console.error(error);
      setLoading(false);
      alert('Falha ao contactar o servidor.');
    }
  };

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto flex flex-col gap-8">
      <header className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-indigo-400 font-bold text-3xl">
          <Music className="w-8 h-8" />
          <span>AI Stem Separator</span>
        </div>
        <p className="text-slate-400">Separa qualquer música do YouTube em faixas isoladas</p>
      </header>

      <form onSubmit={handleSubmit} className="bg-slate-800/80 border border-slate-700 p-6 rounded-2xl shadow-xl flex flex-col sm:flex-row gap-4">
        <input
          type="url"
          placeholder="Cola aqui o link do YouTube..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          className="flex-1 bg-slate-900 border border-slate-700 px-4 py-3 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
        
        <select
          value={stemCount}
          onChange={(e) => setStemCount(Number(e.target.value))}
          disabled={loading}
          className="bg-slate-900 border border-slate-700 px-4 py-3 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
        >
          <option value={4}>4 Faixas (Padrão)</option>
          <option value={6}>6 Faixas (Com Piano e Guitarra)</option>
        </select>

        <button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition flex justify-center items-center gap-2 whitespace-nowrap"
        >
          {loading && <Loader2 className="w-5 h-5 animate-spin" />}
          {loading ? 'A processar...' : 'Separar Faixas'}
        </button>
      </form>

      {loading && (
        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl space-y-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-300">{status}</span>
            <span className="text-indigo-400 font-bold">{progress}%</span>
          </div>
          <div className="w-full bg-slate-700 h-3 rounded-full overflow-hidden">
            <div 
              className="bg-indigo-500 h-full transition-all duration-500 ease-out" 
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {stems && <MultiTrackPlayer stems={stems} />}
    </div>
  );
}

function MultiTrackPlayer({ stems }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const trackRefs = useRef({});
  const wavesurferInstances = useRef({});
  
  // Estados para mixer de áudio
  const [muted, setMuted] = useState({});
  const [solo, setSolo] = useState({});
  const [volumes, setVolumes] = useState({});

  // Novos estados para a Linha do Tempo Geral (Scrubber)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const isSeekingRef = useRef(false);

  const trackInfo = {
    vocals: { label: 'Vocais', color: '#ec4899' },
    drums: { label: 'Bateria', color: '#3b82f6' },
    bass: { label: 'Baixo', color: '#10b981' },
    other: { label: 'Outros', color: '#f59e0b' },
    piano: { label: 'Piano', color: '#8b5cf6' },
    guitar: { label: 'Guitarra', color: '#ef4444' }
  };

  const activeTracks = Object.keys(stems).map(key => ({
    id: key,
    ...trackInfo[key]
  }));

  // Formata os segundos em formato MM:SS
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Sincroniza o tempo de todos os players
  const syncAllTracksToTime = (timeInSeconds) => {
    isSeekingRef.current = true;
    setCurrentTime(timeInSeconds);
    Object.values(wavesurferInstances.current).forEach(ws => {
      ws.setTime(timeInSeconds);
    });
    setTimeout(() => { isSeekingRef.current = false; }, 50);
  };

  // Inicializa os players de áudio
  useEffect(() => {
    activeTracks.forEach((track, index) => {
      if (!trackRefs.current[track.id]) return;

      if (wavesurferInstances.current[track.id]) {
        wavesurferInstances.current[track.id].destroy();
      }

      const ws = WaveSurfer.create({
        container: trackRefs.current[track.id],
        waveColor: '#334155',
        progressColor: track.color,
        height: 60,
        barWidth: 2,
        barGap: 1,
        url: `http://localhost:3001${stems[track.id]}`
      });

      wavesurferInstances.current[track.id] = ws;

      // Usamos a primeira faixa para monitorar a duração e tempo atual em tempo real
      if (index === 0) {
        ws.on('ready', (d) => setDuration(d));
        ws.on('timeupdate', (t) => {
          if (!isSeekingRef.current) setCurrentTime(t);
        });
      }

      // Se o usuário clicar em qualquer forma de onda individual, sincroniza todas as outras!
      ws.on('interaction', () => {
        const targetTime = ws.getCurrentTime();
        syncAllTracksToTime(targetTime);
      });
    });

    return () => {
      Object.values(wavesurferInstances.current).forEach(ws => ws.destroy());
    };
  }, [stems]);

  // Aplica Mute / Solo / Volume
  useEffect(() => {
    const isAnySolo = Object.values(solo).some(val => val);

    activeTracks.forEach(track => {
      const ws = wavesurferInstances.current[track.id];
      if (ws) {
        const isMuted = muted[track.id] || (isAnySolo && !solo[track.id]);
        ws.setMuted(isMuted);
        const currentVolume = volumes[track.id] !== undefined ? volumes[track.id] : 1;
        ws.setVolume(currentVolume);
      }
    });
  }, [muted, solo, volumes, activeTracks]);

  const togglePlay = () => {
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    Object.values(wavesurferInstances.current).forEach(ws => {
      if (nextPlaying) ws.play();
      else ws.pause();
    });
  };

  const toggleMute = (trackId) => {
    setMuted(prev => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const toggleSolo = (trackId) => {
    setSolo(prev => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const handleVolumeChange = (trackId, value) => {
    setVolumes(prev => ({ ...prev, [trackId]: parseFloat(value) }));
  };

  // Salta para frente ou para trás N segundos
  const handleSkip = (seconds) => {
    if (!duration) return;
    let newTime = currentTime + seconds;
    if (newTime < 0) newTime = 0;
    if (newTime > duration) newTime = duration;
    syncAllTracksToTime(newTime);
  };

  return (
    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl space-y-6 shadow-2xl">
      
      {/* PAINEL DE CONTROLE MASTER / LINHA DO TEMPO */}
      <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-700 space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald-400 w-6 h-6" />
            <h3 className="text-xl font-bold">{activeTracks.length} Faixas Carregadas</h3>
          </div>

          <div className="flex items-center gap-3">
            {/* Botão Recuar 10s */}
            <button
              onClick={() => handleSkip(-10)}
              title="Recuar 10s"
              className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition text-slate-300"
            >
              <Rewind className="w-5 h-5" />
            </button>

            {/* Botão Play / Pause Principal */}
            <button
              onClick={togglePlay}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 transition"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 text-slate-950" />}
              {isPlaying ? 'Pausar Tudo' : 'Tocar Tudo'}
            </button>

            {/* Botão Avançar 10s */}
            <button
              onClick={() => handleSkip(10)}
              title="Avançar 10s"
              className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition text-slate-300"
            >
              <FastForward className="w-5 h-5" />
            </button>
          </div>

          {/* Relógio de Duração */}
          <div className="font-mono text-sm text-indigo-400 bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        {/* Barra de Navegação Master (Scrubber) */}
        <div className="space-y-1">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={(e) => syncAllTracksToTime(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
        </div>
      </div>

      {/* LISTA DAS FAIXAS INDIVIDUAIS */}
      <div className="space-y-4">
        {activeTracks.map(track => (
          <div key={track.id} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-4">
            
            {/* Controlos Superiores da Faixa */}
            <div className="flex justify-between items-center">
              <span className="font-bold text-sm tracking-wide" style={{ color: track.color }}>
                {track.label.toUpperCase()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleSolo(track.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition ${
                    solo[track.id] 
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' 
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  {solo[track.id] ? 'Isolado' : 'Isolar'}
                </button>

                <button
                  onClick={() => toggleMute(track.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition ${
                    muted[track.id] 
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {muted[track.id] ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  {muted[track.id] ? 'Mutado' : 'Mute'}
                </button>
              </div>
            </div>

            {/* Controlo de Volume Deslizante */}
            <div className="flex items-center gap-3">
              <VolumeX className="w-4 h-4 text-slate-600" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volumes[track.id] !== undefined ? volumes[track.id] : 1}
                onChange={(e) => handleVolumeChange(track.id, e.target.value)}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <Volume2 className="w-4 h-4 text-slate-400" />
            </div>

            {/* Onda Sonora */}
            <div ref={el => trackRefs.current[track.id] = el} className="w-full cursor-pointer" />
          </div>
        ))}
      </div>
    </div>
  );
}