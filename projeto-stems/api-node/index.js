const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '../api-python/public')));

const jobsDatabase = {};

app.post('/api/separate', async (req, res) => {
  const { youtubeUrl, stemCount } = req.body; // Agora recebe o stemCount
  if (!youtubeUrl) return res.status(400).json({ error: 'Link é obrigatório' });

  const jobId = `job_${Date.now()}`;
  jobsDatabase[jobId] = { jobId, status: 'A iniciar...', progress: 5 };

  res.json({ jobId });

  try {

    const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
    const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://projeto-stems-2.onrender.com';

    await axios.post(`${PYTHON_API_URL}/process`, {
      job_id: jobId,
      youtube_url: youtubeUrl,
      callback_url: `${BACKEND_URL}/api/callback`,
      stem_count: stemCount || 4 // Passa para o Python (4 é o padrão)
    });
  } catch (err) {
    console.error('Erro ao chamar o Python:', err.message);
    io.emit(`job_update:${jobId}`, { status: 'Erro: API Python desligada', error: err.message });
  }
});

app.post('/api/callback', (req, res) => {
  const { job_id, status, progress, stems, error } = req.body;
  if (jobsDatabase[job_id]) {
    jobsDatabase[job_id] = { ...jobsDatabase[job_id], status, progress, stems, error };
    io.emit(`job_update:${job_id}`, jobsDatabase[job_id]);
  }
  res.json({ ok: true });
});

server.listen(3001, () => {
  console.log('✅ Maestro Node.js a correr na porta 3001');
});