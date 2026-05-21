'use strict';

const socket = io();

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

let localStream = null;
let pc = null;
let roomId = null;
let myContext = '';
let facingMode = 'environment';

function $(id) { return document.getElementById(id); }

function show(id) {
  document.querySelectorAll('[data-screen]').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}

// ── CAMERA ──

async function startCamera(facing) {
  facing = facing || facingMode;
  if (localStream) localStream.getTracks().forEach(t => t.stop());

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    $('local-setup').srcObject = localStream;
    $('local-waiting').srcObject = localStream;
    $('local-video').srcObject = localStream;
    show('s-setup');
    $('perm-err').textContent = '';
  } catch (err) {
    $('perm-err').textContent = 'Ошибка камеры: ' + err.message;
  }
}

async function toggleCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera(facingMode);
}

// ── FIND ──

function findEyes() {
  myContext = $('context-input').value.trim() || 'смотрю в мир';
  $('my-ctx').textContent = myContext;
  $('wait-hint').textContent = '';
  show('s-waiting');
  socket.emit('join-pool', { context: myContext });
}

function cancelWait() {
  socket.emit('leave');
  show('s-setup');
}

// ── SOCKET ──

socket.on('waiting', () => {
  $('wait-text').textContent = 'Ищем похожий взгляд...';
  let secs = 0;
  const t = setInterval(() => {
    secs++;
    $('wait-hint').textContent = secs + 's · будем первыми в сети';
    if (!document.getElementById('s-waiting').classList.contains('active')) clearInterval(t);
  }, 1000);
});

socket.on('matched', async ({ role, roomId: rid, peerContext, matchPct, commonTags }) => {
  roomId = rid;

  $('peer-ctx').textContent = peerContext;
  $('match-pct').textContent = matchPct + '%';
  renderTags(commonTags, peerContext);
  show('s-connected');

  pc = new RTCPeerConnection(ICE);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = e => {
    const rv = $('remote-video');
    if (rv.srcObject !== e.streams[0]) {
      rv.srcObject = e.streams[0];
      rv.style.display = '';
      $('remote-wait').style.display = 'none';
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('signal', { roomId, data: { ice: candidate } });
  };

  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      handlePeerLeft();
    }
  };

  if (role === 'caller') {
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    socket.emit('signal', { roomId, data: { offer } });
  }
});

socket.on('signal', async ({ data }) => {
  if (!pc) return;
  try {
    if (data.offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { roomId, data: { answer } });
    }
    if (data.answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    if (data.ice) {
      await pc.addIceCandidate(new RTCIceCandidate(data.ice));
    }
  } catch (err) {
    console.error('signal error', err.message);
  }
});

socket.on('peer-left', handlePeerLeft);

socket.on('disconnect', () => {
  if (document.getElementById('s-connected').classList.contains('active')) {
    handlePeerLeft();
  }
});

function handlePeerLeft() {
  if (pc) { pc.close(); pc = null; }
  const rv = $('remote-video');
  rv.srcObject = null; rv.style.display = 'none';
  $('remote-wait').style.display = '';
  show('s-feedback');
}

function leaveRoom() {
  socket.emit('leave');
  if (pc) { pc.close(); pc = null; }
  show('s-feedback');
}

function searchAgain() { show('s-setup'); }
function showHelped()   { show('s-helped'); }
function showNotHelped(){ show('s-not-helped'); }
function showFuture()   { show('s-future'); }

// ── TAGS ──

function renderTags(common, peerCtx) {
  const peer = peerCtx.split(/[\s,·]+/).filter(w => w.length > 2).slice(0, 4);
  const used = new Set(common.map(w => w.toLowerCase()));
  const extra = peer.filter(w => !used.has(w.toLowerCase()));

  const tags = [
    ...common.slice(0, 3).map(t => ({ text: '✓ ' + t, m: true })),
    ...extra.slice(0, 3).map(t => ({ text: t, m: false })),
  ].slice(0, 6);

  $('ai-tags').innerHTML = tags.map(({ text, m }) =>
    `<span class="ai-tag${m ? ' m' : ''}">${text}</span>`
  ).join('');
}

// ── BOOT ──
startCamera();
