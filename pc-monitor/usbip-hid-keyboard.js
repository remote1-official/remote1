'use strict';

const net = require('net');

// ─── USB/IP 가상 HID 키보드 서버 ───────────────────────────────────────────
// 컴2에서 localhost로 실행, usbip attach로 가상 USB 키보드 생성

const PROTO_VERSION = 0x0111;

// 일반적인 USB 키보드로 위장
const VID = 0x046D;   // Logitech
const PID = 0xC31C;   // Logitech Keyboard K120
const BUSID = '1-2';
const DEVPATH = '/sys/devices/pci0000:00/0000:00:01.2/usb1/1-2';
const BUSNUM = 1;
const DEVNUM = 3;
const SPEED = 2; // USB Full Speed

// ─── USB 디스크립터 ──────────────────────────────────────────────────────────

const deviceDesc = Buffer.from([
  0x12, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x08,
  0x6D, 0x04, 0x1C, 0xC3, 0x00, 0x01, 0x00, 0x00,
  0x00, 0x01
]);

// Boot Keyboard HID Report Descriptor (63 bytes)
const kbReportDesc = Buffer.from([
  0x05, 0x01,       // Usage Page (Generic Desktop)
  0x09, 0x06,       // Usage (Keyboard)
  0xA1, 0x01,       // Collection (Application)
  // Modifier keys (8 bits)
  0x05, 0x07,       //   Usage Page (Key Codes)
  0x19, 0xE0,       //   Usage Minimum (Left Control)
  0x29, 0xE7,       //   Usage Maximum (Right GUI)
  0x15, 0x00,       //   Logical Minimum (0)
  0x25, 0x01,       //   Logical Maximum (1)
  0x75, 0x01,       //   Report Size (1)
  0x95, 0x08,       //   Report Count (8)
  0x81, 0x02,       //   Input (Data, Variable, Absolute)
  // Reserved byte
  0x95, 0x01,       //   Report Count (1)
  0x75, 0x08,       //   Report Size (8)
  0x81, 0x01,       //   Input (Constant)
  // LED output (5 bits + 3 padding)
  0x95, 0x05,       //   Report Count (5)
  0x75, 0x01,       //   Report Size (1)
  0x05, 0x08,       //   Usage Page (LEDs)
  0x19, 0x01,       //   Usage Minimum (Num Lock)
  0x29, 0x05,       //   Usage Maximum (Kana)
  0x91, 0x02,       //   Output (Data, Variable, Absolute)
  0x95, 0x01,       //   Report Count (1)
  0x75, 0x03,       //   Report Size (3)
  0x91, 0x01,       //   Output (Constant)
  // Key codes (6 bytes)
  0x95, 0x06,       //   Report Count (6)
  0x75, 0x08,       //   Report Size (8)
  0x15, 0x00,       //   Logical Minimum (0)
  0x25, 0x65,       //   Logical Maximum (101)
  0x05, 0x07,       //   Usage Page (Key Codes)
  0x19, 0x00,       //   Usage Minimum (0)
  0x29, 0x65,       //   Usage Maximum (101)
  0x81, 0x00,       //   Input (Data, Array)
  0xC0              // End Collection
]);

// Full Configuration Descriptor (9+9+9+7 = 34 bytes)
const configDesc = Buffer.from([
  // Configuration descriptor
  0x09, 0x02,
  0x22, 0x00,       // wTotalLength = 34
  0x01, 0x01, 0x00, 0x80, 0x32,
  // Interface descriptor (HID Boot Keyboard)
  0x09, 0x04, 0x00, 0x00, 0x01, 0x03, 0x01, 0x01, 0x00,
  // HID descriptor
  0x09, 0x21, 0x01, 0x01, 0x00, 0x01, 0x22,
  kbReportDesc.length & 0xFF, (kbReportDesc.length >> 8) & 0xFF,
  // Endpoint descriptor (EP1 IN, Interrupt, 8 bytes, 10ms)
  0x07, 0x05, 0x81, 0x03, 0x08, 0x00, 0x0A
]);

// ─── 상태 ────────────────────────────────────────────────────────────────────
let pendingInterruptIn = null;
let attachedSocket = null;
let isAttached = false;

// ─── 디바이스 정보 버퍼 생성 ─────────────────────────────────────────────────
function makeDeviceInfo() {
  const buf = Buffer.alloc(312, 0);
  buf.write(DEVPATH, 0, 'utf8');
  buf.write(BUSID, 256, 'utf8');
  buf.writeUInt32BE(BUSNUM, 288);
  buf.writeUInt32BE(DEVNUM, 292);
  buf.writeUInt32BE(SPEED, 296);
  buf.writeUInt16BE(VID, 300);
  buf.writeUInt16BE(PID, 302);
  buf.writeUInt16BE(0x0100, 304);
  buf[306] = 0x00;  // bDeviceClass
  buf[307] = 0x00;  // bDeviceSubClass
  buf[308] = 0x00;  // bDeviceProtocol
  buf[309] = 0x01;  // bConfigurationValue
  buf[310] = 0x01;  // bNumConfigurations
  buf[311] = 0x01;  // bNumInterfaces
  return buf;
}

// ─── 프로토콜 핸들러 ─────────────────────────────────────────────────────────

function handleDevList(socket) {
  console.log('[USBIP-KB] OP_REQ_DEVLIST 수신');
  const header = Buffer.alloc(12);
  header.writeUInt16BE(PROTO_VERSION, 0);
  header.writeUInt16BE(0x0005, 2);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(1, 8);
  const devInfo = makeDeviceInfo();
  const iface = Buffer.from([0x03, 0x01, 0x01, 0x00]); // HID, Boot, Keyboard
  socket.write(Buffer.concat([header, devInfo, iface]));
}

function handleImport(socket, busid) {
  const reqBusid = busid.toString('utf8').replace(/\0+$/, '');
  console.log(`[USBIP-KB] OP_REQ_IMPORT — busid: ${reqBusid}`);
  if (reqBusid !== BUSID) {
    const err = Buffer.alloc(8);
    err.writeUInt16BE(PROTO_VERSION, 0);
    err.writeUInt16BE(0x0003, 2);
    err.writeUInt32BE(1, 4);
    socket.write(err);
    return;
  }
  const header = Buffer.alloc(8);
  header.writeUInt16BE(PROTO_VERSION, 0);
  header.writeUInt16BE(0x0003, 2);
  header.writeUInt32BE(0, 4);
  const devInfo = makeDeviceInfo();
  socket.write(Buffer.concat([header, devInfo]));
  isAttached = true;
  attachedSocket = socket;
  console.log('[USBIP-KB] 키보드 연결됨 — URB 모드 시작');
}

function makeRetSubmit(seqnum, status, data) {
  const header = Buffer.alloc(48, 0);
  header.writeUInt32BE(0x00000003, 0);
  header.writeUInt32BE(seqnum, 4);
  header.writeInt32BE(status, 20);
  header.writeUInt32BE(data ? data.length : 0, 24);
  if (data && data.length > 0) {
    return Buffer.concat([header, data]);
  }
  return header;
}

function makeRetUnlink(seqnum, status) {
  const header = Buffer.alloc(48, 0);
  header.writeUInt32BE(0x00000004, 0);
  header.writeUInt32BE(seqnum, 4);
  header.writeInt32BE(status, 20);
  return header;
}

function handleControlTransfer(seqnum, setup, wLength) {
  const bmRequestType = setup[0];
  const bRequest = setup[1];
  const wValue = setup.readUInt16LE(2);
  const descType = (wValue >> 8) & 0xFF;
  const descIndex = wValue & 0xFF;

  if (bmRequestType === 0x80 && bRequest === 0x06) {
    if (descType === 0x01) {
      const data = deviceDesc.slice(0, Math.min(deviceDesc.length, wLength));
      return makeRetSubmit(seqnum, 0, data);
    }
    if (descType === 0x02) {
      const data = configDesc.slice(0, Math.min(configDesc.length, wLength));
      return makeRetSubmit(seqnum, 0, data);
    }
    if (descType === 0x03) {
      if (descIndex === 0) {
        return makeRetSubmit(seqnum, 0, Buffer.from([0x04, 0x03, 0x09, 0x04]));
      }
      return makeRetSubmit(seqnum, 0, Buffer.from([0x02, 0x03]));
    }
  }

  if (bmRequestType === 0x81 && bRequest === 0x06) {
    if (descType === 0x22) {
      const data = kbReportDesc.slice(0, Math.min(kbReportDesc.length, wLength));
      return makeRetSubmit(seqnum, 0, data);
    }
    if (descType === 0x21) {
      const hidDesc = configDesc.slice(18, 27);
      return makeRetSubmit(seqnum, 0, hidDesc.slice(0, Math.min(hidDesc.length, wLength)));
    }
  }

  if (bmRequestType === 0x80 && bRequest === 0x00) {
    return makeRetSubmit(seqnum, 0, Buffer.from([0x00, 0x00]));
  }
  if (bmRequestType === 0x00 && bRequest === 0x09) {
    return makeRetSubmit(seqnum, 0, null);
  }
  if (bmRequestType === 0x21 && bRequest === 0x0A) {
    return makeRetSubmit(seqnum, 0, null);
  }
  if (bmRequestType === 0x21 && bRequest === 0x0B) {
    return makeRetSubmit(seqnum, 0, null);
  }
  if (bmRequestType === 0x21 && bRequest === 0x09) {
    return makeRetSubmit(seqnum, 0, null);
  }
  if (bmRequestType === 0x00 && bRequest === 0x05) {
    return makeRetSubmit(seqnum, 0, null);
  }
  if (bmRequestType === 0x02 && bRequest === 0x01) {
    return makeRetSubmit(seqnum, 0, null);
  }

  console.log(`[USBIP-KB] 미처리 제어: bmReq=0x${bmRequestType.toString(16)} bReq=0x${bRequest.toString(16)} wVal=0x${wValue.toString(16)}`);
  return makeRetSubmit(seqnum, -32, null);
}

function handleURB(socket, data) {
  if (data.length < 48) return;
  const command = data.readUInt32BE(0);
  const seqnum = data.readUInt32BE(4);
  const direction = data.readUInt32BE(12);
  const ep = data.readUInt32BE(16);
  const transferLen = data.readUInt32BE(24);

  if (command === 0x00000001) {
    if (ep === 0) {
      const setup = data.slice(40, 48);
      const reply = handleControlTransfer(seqnum, setup, transferLen);
      if (reply) socket.write(reply);
    } else if (ep === 1 && direction === 1) {
      pendingInterruptIn = { seqnum, socket, transferLen };
    } else if (direction === 0 && transferLen > 0) {
      socket.write(makeRetSubmit(seqnum, 0, null));
    } else {
      socket.write(makeRetSubmit(seqnum, 0, Buffer.alloc(Math.min(transferLen, 8), 0)));
    }
  } else if (command === 0x00000002) {
    const unlinkSeqnum = data.readUInt32BE(20);
    if (pendingInterruptIn && pendingInterruptIn.seqnum === unlinkSeqnum) {
      pendingInterruptIn = null;
    }
    socket.write(makeRetUnlink(seqnum, -104));
  }
}

// ─── 키보드 입력 전송 ────────────────────────────────────────────────────────

// report: 8 bytes [modifiers, 0x00, key1, key2, key3, key4, key5, key6]
function sendKeyboardReport(modifiers, keys) {
  if (!pendingInterruptIn || !attachedSocket) return false;

  const report = Buffer.alloc(8, 0);
  report[0] = modifiers & 0xFF;
  // report[1] = 0x00 (reserved)
  for (let i = 0; i < Math.min(keys.length, 6); i++) {
    report[2 + i] = keys[i] & 0xFF;
  }

  const reply = makeRetSubmit(pendingInterruptIn.seqnum, 0, report);
  pendingInterruptIn = null;

  try {
    attachedSocket.write(reply);
    return true;
  } catch (e) {
    console.log(`[USBIP-KB] 리포트 전송 실패: ${e.message}`);
    return false;
  }
}

// ─── TCP 서버 ────────────────────────────────────────────────────────────────

let server = null;
let urbBuffer = Buffer.alloc(0);

function startServer(port) {
  port = port || 3241;
  server = net.createServer((socket) => {
    let phase = 'op';
    let buffer = Buffer.alloc(0);

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
          const busid = buffer.slice(8, 40);
          handleImport(socket, busid);
          buffer = buffer.slice(40);
          phase = 'urb';
          urbBuffer = Buffer.alloc(0);
        }
      }

      if (phase === 'urb') {
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
            handleURB(socket, urbBuffer.slice(0, totalLen));
            urbBuffer = urbBuffer.slice(totalLen);
          } else if (command === 0x00000002) {
            if (urbBuffer.length < 48) break;
            handleURB(socket, urbBuffer.slice(0, 48));
            urbBuffer = urbBuffer.slice(48);
          } else {
            urbBuffer = urbBuffer.slice(4);
          }
        }
      }
    });

    socket.on('error', (err) => {
      console.log(`[USBIP-KB] 소켓 에러: ${err.message}`);
    });

    socket.on('close', () => {
      if (isAttached && attachedSocket === socket) {
        console.log('[USBIP-KB] 키보드 연결 해제');
        isAttached = false;
        attachedSocket = null;
        pendingInterruptIn = null;
      }
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[USBIP-KB] 가상 키보드 서버 시작 — 127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    console.log(`[USBIP-KB] 서버 에러: ${err.message}`);
  });

  return server;
}

function stopServer() {
  if (server) { server.close(); server = null; }
  if (attachedSocket) { attachedSocket.destroy(); attachedSocket = null; }
  isAttached = false;
  pendingInterruptIn = null;
  console.log('[USBIP-KB] 서버 중지');
}

function isDeviceAttached() { return isAttached; }

module.exports = { startServer, stopServer, sendKeyboardReport, isDeviceAttached };
