'use strict';

const net = require('net');

// ─── USB/IP 가상 HID 마우스 + 키보드 통합 서버 ──────────────────────────────
// 포트 3240 하나에서 마우스(1-1)와 키보드(1-2) 모두 제공
// usbip attach -r 127.0.0.1 -b 1-1  → 마우스
// usbip attach -r 127.0.0.1 -b 1-2  → 키보드

const USBIP_PORT = 3240;
const PROTO_VERSION = 0x0111;

// ─── 마우스 디바이스 정의 ────────────────────────────────────────────────────

const MOUSE = {
  VID: 0x046D, PID: 0xC092,  // Logitech G102
  BUSID: '1-1',
  DEVPATH: '/sys/devices/pci0000:00/0000:00:01.2/usb1/1-1',
  BUSNUM: 1, DEVNUM: 2, SPEED: 2,
  ifClass: 0x03, ifSubClass: 0x01, ifProtocol: 0x02, // HID Boot Mouse
};

MOUSE.reportDesc = Buffer.from([
  0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x09, 0x01,
  0xA1, 0x00, 0x05, 0x09, 0x19, 0x01, 0x29, 0x03,
  0x15, 0x00, 0x25, 0x01, 0x95, 0x03, 0x75, 0x01,
  0x81, 0x02, 0x95, 0x01, 0x75, 0x05, 0x81, 0x01,
  0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38,
  0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03,
  0x81, 0x06, 0xC0, 0xC0
]);

MOUSE.deviceDesc = Buffer.from([
  0x12, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x08,
  0x6D, 0x04, 0x92, 0xC0, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
]);

MOUSE.configDesc = Buffer.from([
  0x09, 0x02, 0x22, 0x00, 0x01, 0x01, 0x00, 0x80, 0x32,
  0x09, 0x04, 0x00, 0x00, 0x01, 0x03, 0x01, 0x02, 0x00,
  0x09, 0x21, 0x01, 0x01, 0x00, 0x01, 0x22,
  MOUSE.reportDesc.length & 0xFF, (MOUSE.reportDesc.length >> 8) & 0xFF,
  0x07, 0x05, 0x81, 0x03, 0x08, 0x00, 0x0A
]);

// ─── 키보드 디바이스 정의 ────────────────────────────────────────────────────

const KEYBOARD = {
  VID: 0x046D, PID: 0xC31C,  // Logitech K120
  BUSID: '1-2',
  DEVPATH: '/sys/devices/pci0000:00/0000:00:01.2/usb1/1-2',
  BUSNUM: 1, DEVNUM: 3, SPEED: 2,
  ifClass: 0x03, ifSubClass: 0x01, ifProtocol: 0x01, // HID Boot Keyboard
};

KEYBOARD.reportDesc = Buffer.from([
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01,
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7,
  0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x08, 0x81, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x05, 0x08,
  0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01,
  0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65,
  0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00,
  0xC0
]);

KEYBOARD.deviceDesc = Buffer.from([
  0x12, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x08,
  0x6D, 0x04, 0x1C, 0xC3, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
]);

KEYBOARD.configDesc = Buffer.from([
  0x09, 0x02, 0x22, 0x00, 0x01, 0x01, 0x00, 0x80, 0x32,
  0x09, 0x04, 0x00, 0x00, 0x01, 0x03, 0x01, 0x01, 0x00,
  0x09, 0x21, 0x01, 0x01, 0x00, 0x01, 0x22,
  KEYBOARD.reportDesc.length & 0xFF, (KEYBOARD.reportDesc.length >> 8) & 0xFF,
  0x07, 0x05, 0x81, 0x03, 0x08, 0x00, 0x0A
]);

// ─── 디바이스별 상태 ─────────────────────────────────────────────────────────
const devices = {
  '1-1': { def: MOUSE,    pendingIn: null, socket: null, attached: false, reportQueue: [] },
  '1-2': { def: KEYBOARD, pendingIn: null, socket: null, attached: false, reportQueue: [] },
};

// ─── 공통 함수 ──────────────────────────────────────────────────────────────

function makeDeviceInfo(dev) {
  const buf = Buffer.alloc(312, 0);
  buf.write(dev.DEVPATH, 0, 'utf8');
  buf.write(dev.BUSID, 256, 'utf8');
  buf.writeUInt32BE(dev.BUSNUM, 288);
  buf.writeUInt32BE(dev.DEVNUM, 292);
  buf.writeUInt32BE(dev.SPEED, 296);
  buf.writeUInt16BE(dev.VID, 300);
  buf.writeUInt16BE(dev.PID, 302);
  buf.writeUInt16BE(0x0100, 304);
  buf[306] = 0x00; buf[307] = 0x00; buf[308] = 0x00;
  buf[309] = 0x01; buf[310] = 0x01; buf[311] = 0x01;
  return buf;
}

function makeIfaceInfo(dev) {
  return Buffer.from([dev.ifClass, dev.ifSubClass, dev.ifProtocol, 0x00]);
}

function makeRetSubmit(seqnum, status, data) {
  const header = Buffer.alloc(48, 0);
  header.writeUInt32BE(0x00000003, 0);
  header.writeUInt32BE(seqnum, 4);
  header.writeInt32BE(status, 20);
  header.writeUInt32BE(data ? data.length : 0, 24);
  return data && data.length > 0 ? Buffer.concat([header, data]) : header;
}

function makeRetUnlink(seqnum, status) {
  const header = Buffer.alloc(48, 0);
  header.writeUInt32BE(0x00000004, 0);
  header.writeUInt32BE(seqnum, 4);
  header.writeInt32BE(status, 20);
  return header;
}

// ─── 프로토콜 핸들러 ─────────────────────────────────────────────────────────

function handleDevList(socket) {
  console.log('[USBIP] OP_REQ_DEVLIST 수신');
  const header = Buffer.alloc(12);
  header.writeUInt16BE(PROTO_VERSION, 0);
  header.writeUInt16BE(0x0005, 2);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(2, 8); // 2 devices

  const parts = [header];
  for (const busid of ['1-1', '1-2']) {
    const dev = devices[busid].def;
    parts.push(makeDeviceInfo(dev));
    parts.push(makeIfaceInfo(dev));
  }
  socket.write(Buffer.concat(parts));
  console.log('[USBIP] OP_REP_DEVLIST 전송 (마우스 + 키보드)');
}

function handleImport(socket, busidBuf) {
  const busid = busidBuf.toString('utf8').replace(/\0+$/, '');
  console.log(`[USBIP] OP_REQ_IMPORT — busid: ${busid}`);

  const devState = devices[busid];
  if (!devState) {
    console.log(`[USBIP] 알 수 없는 busid: ${busid}`);
    const err = Buffer.alloc(8);
    err.writeUInt16BE(PROTO_VERSION, 0);
    err.writeUInt16BE(0x0003, 2);
    err.writeUInt32BE(1, 4);
    socket.write(err);
    return null;
  }

  const header = Buffer.alloc(8);
  header.writeUInt16BE(PROTO_VERSION, 0);
  header.writeUInt16BE(0x0003, 2);
  header.writeUInt32BE(0, 4);
  socket.write(Buffer.concat([header, makeDeviceInfo(devState.def)]));

  devState.attached = true;
  devState.socket = socket;
  const name = busid === '1-1' ? '마우스' : '키보드';
  console.log(`[USBIP] ${name} 연결됨 — URB 모드 시작`);
  return busid;
}

function handleControlTransfer(dev, seqnum, setup, wLength) {
  const bmRequestType = setup[0];
  const bRequest = setup[1];
  const wValue = setup.readUInt16LE(2);
  const descType = (wValue >> 8) & 0xFF;
  const descIndex = wValue & 0xFF;

  if (bmRequestType === 0x80 && bRequest === 0x06) {
    if (descType === 0x01) {
      return makeRetSubmit(seqnum, 0, dev.deviceDesc.slice(0, Math.min(dev.deviceDesc.length, wLength)));
    }
    if (descType === 0x02) {
      return makeRetSubmit(seqnum, 0, dev.configDesc.slice(0, Math.min(dev.configDesc.length, wLength)));
    }
    if (descType === 0x03) {
      if (descIndex === 0) return makeRetSubmit(seqnum, 0, Buffer.from([0x04, 0x03, 0x09, 0x04]));
      return makeRetSubmit(seqnum, 0, Buffer.from([0x02, 0x03]));
    }
  }
  if (bmRequestType === 0x81 && bRequest === 0x06) {
    if (descType === 0x22) {
      return makeRetSubmit(seqnum, 0, dev.reportDesc.slice(0, Math.min(dev.reportDesc.length, wLength)));
    }
    if (descType === 0x21) {
      const hidDesc = dev.configDesc.slice(18, 27);
      return makeRetSubmit(seqnum, 0, hidDesc.slice(0, Math.min(hidDesc.length, wLength)));
    }
  }
  if (bmRequestType === 0x80 && bRequest === 0x00) return makeRetSubmit(seqnum, 0, Buffer.from([0x00, 0x00]));
  if (bmRequestType === 0x00 && bRequest === 0x09) return makeRetSubmit(seqnum, 0, null);
  if (bmRequestType === 0x21 && bRequest === 0x0A) return makeRetSubmit(seqnum, 0, null);
  if (bmRequestType === 0x21 && bRequest === 0x0B) return makeRetSubmit(seqnum, 0, null);
  if (bmRequestType === 0x21 && bRequest === 0x09) return makeRetSubmit(seqnum, 0, null);
  if (bmRequestType === 0xA1 && bRequest === 0x01) return makeRetSubmit(seqnum, 0, Buffer.alloc(8, 0));
  if (bmRequestType === 0x00 && bRequest === 0x05) return makeRetSubmit(seqnum, 0, null);
  if (bmRequestType === 0x02 && bRequest === 0x01) return makeRetSubmit(seqnum, 0, null);

  return makeRetSubmit(seqnum, -32, null);
}

function handleURB(devState, socket, data) {
  if (data.length < 48) return;
  const command = data.readUInt32BE(0);
  const seqnum = data.readUInt32BE(4);
  const direction = data.readUInt32BE(12);
  const ep = data.readUInt32BE(16);
  const transferLen = data.readUInt32BE(24);

  if (command === 0x00000001) {
    if (ep === 0) {
      const setup = data.slice(40, 48);
      const reply = handleControlTransfer(devState.def, seqnum, setup, transferLen);
      if (reply) socket.write(reply);
    } else if (ep === 1 && direction === 1) {
      // 큐에 대기 중인 리포트가 있으면 즉시 응답
      if (devState.reportQueue.length > 0) {
        const report = devState.reportQueue.shift();
        socket.write(makeRetSubmit(seqnum, 0, report));
      } else {
        devState.pendingIn = { seqnum, socket, transferLen };
      }
    } else if (direction === 0 && transferLen > 0) {
      socket.write(makeRetSubmit(seqnum, 0, null));
    } else {
      socket.write(makeRetSubmit(seqnum, 0, Buffer.alloc(Math.min(transferLen, 8), 0)));
    }
  } else if (command === 0x00000002) {
    const unlinkSeqnum = data.readUInt32BE(20);
    if (devState.pendingIn && devState.pendingIn.seqnum === unlinkSeqnum) {
      devState.pendingIn = null;
    }
    socket.write(makeRetUnlink(seqnum, -104));
  }
}

// ─── 입력 전송 API ──────────────────────────────────────────────────────────

function sendMouseReport(buttons, dx, dy, wheel) {
  const dev = devices['1-1'];
  if (!dev.socket) return false;
  const report = Buffer.alloc(4);
  report[0] = buttons & 0xFF;
  report[1] = dx < 0 ? 256 + dx : dx;
  report[2] = dy < 0 ? 256 + dy : dy;
  report[3] = wheel < 0 ? 256 + wheel : wheel;

  if (dev.pendingIn) {
    const reply = makeRetSubmit(dev.pendingIn.seqnum, 0, report);
    dev.pendingIn = null;
    try { dev.socket.write(reply); return true; } catch (_) { return false; }
  } else {
    // 큐에 저장 (최대 8개, 오래된 것 버림)
    if (dev.reportQueue.length >= 8) dev.reportQueue.shift();
    dev.reportQueue.push(report);
    return true;
  }
}

function sendKeyboardReport(modifiers, keys) {
  const dev = devices['1-2'];
  if (!dev.socket) return false;
  const report = Buffer.alloc(8, 0);
  report[0] = modifiers & 0xFF;
  for (let i = 0; i < Math.min(keys.length, 6); i++) {
    report[2 + i] = keys[i] & 0xFF;
  }

  if (dev.pendingIn) {
    const reply = makeRetSubmit(dev.pendingIn.seqnum, 0, report);
    dev.pendingIn = null;
    try { dev.socket.write(reply); return true; } catch (_) { return false; }
  } else {
    if (dev.reportQueue.length >= 8) dev.reportQueue.shift();
    dev.reportQueue.push(report);
    return true;
  }
}

// ─── TCP 서버 ────────────────────────────────────────────────────────────────

let server = null;

function startServer(port) {
  port = port || USBIP_PORT;

  server = net.createServer((socket) => {
    let phase = 'op';
    let buffer = Buffer.alloc(0);
    let urbBuffer = Buffer.alloc(0);
    let connBusid = null; // 이 연결이 어떤 디바이스에 바인딩됐는지

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (phase === 'op') {
        if (buffer.length < 8) return;
        const command = buffer.readUInt16BE(2);

        if (command === 0x8005) {
          handleDevList(socket);
          buffer = buffer.slice(8);
        } else if (command === 0x8003) {
          if (buffer.length < 40) return;
          const busidBuf = buffer.slice(8, 40);
          connBusid = handleImport(socket, busidBuf);
          buffer = buffer.slice(40);
          if (connBusid) {
            phase = 'urb';
            urbBuffer = Buffer.alloc(0);
          }
        }
      }

      if (phase === 'urb' && connBusid) {
        urbBuffer = Buffer.concat([urbBuffer, buffer]);
        buffer = Buffer.alloc(0);

        while (urbBuffer.length >= 48) {
          const command = urbBuffer.readUInt32BE(0);
          if (command === 0x00000001) {
            const direction = urbBuffer.readUInt32BE(12);
            const transferLen = urbBuffer.readUInt32BE(24);
            let totalLen = 48;
            if (direction === 0 && transferLen > 0) totalLen += transferLen;
            if (urbBuffer.length < totalLen) break;
            handleURB(devices[connBusid], socket, urbBuffer.slice(0, totalLen));
            urbBuffer = urbBuffer.slice(totalLen);
          } else if (command === 0x00000002) {
            if (urbBuffer.length < 48) break;
            handleURB(devices[connBusid], socket, urbBuffer.slice(0, 48));
            urbBuffer = urbBuffer.slice(48);
          } else {
            urbBuffer = urbBuffer.slice(4);
          }
        }
      }
    });

    socket.on('error', (err) => console.log(`[USBIP] 소켓 에러: ${err.message}`));

    socket.on('close', () => {
      if (connBusid && devices[connBusid].socket === socket) {
        const name = connBusid === '1-1' ? '마우스' : '키보드';
        console.log(`[USBIP] ${name} 연결 해제`);
        devices[connBusid].attached = false;
        devices[connBusid].socket = null;
        devices[connBusid].pendingIn = null;
      }
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[USBIP] 통합 HID 서버 시작 — 127.0.0.1:${port} (마우스 + 키보드)`);
  });

  server.on('error', (err) => console.log(`[USBIP] 서버 에러: ${err.message}`));
  return server;
}

function stopServer() {
  for (const busid of Object.keys(devices)) {
    const d = devices[busid];
    if (d.socket) { d.socket.destroy(); d.socket = null; }
    d.attached = false;
    d.pendingIn = null;
  }
  if (server) { server.close(); server = null; }
  console.log('[USBIP] 서버 중지');
}

function isMouseAttached() { return devices['1-1'].attached; }
function isKeyboardAttached() { return devices['1-2'].attached; }

module.exports = {
  startServer, stopServer,
  sendMouseReport, sendKeyboardReport,
  isMouseAttached, isKeyboardAttached,
  USBIP_PORT,
};
