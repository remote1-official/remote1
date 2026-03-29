'use strict';

const net = require('net');
const hidServer = require('./usbip-hid-server');

// 1) 서버 시작
console.log('=== USB/IP HID 서버 테스트 ===\n');
hidServer.startServer(13240);

setTimeout(() => {
  // 2) OP_REQ_DEVLIST 테스트
  console.log('\n--- TEST 1: OP_REQ_DEVLIST ---');
  const client1 = net.connect(13240, '127.0.0.1', () => {
    const req = Buffer.alloc(8);
    req.writeUInt16BE(0x0111, 0);  // version
    req.writeUInt16BE(0x8005, 2);  // OP_REQ_DEVLIST
    req.writeUInt32BE(0, 4);       // status
    client1.write(req);
  });

  client1.on('data', (data) => {
    console.log(`응답 크기: ${data.length} bytes`);
    const version = data.readUInt16BE(0);
    const command = data.readUInt16BE(2);
    const status = data.readUInt32BE(4);
    const nDevices = data.readUInt32BE(8);
    console.log(`version=0x${version.toString(16)}, command=0x${command.toString(16)}, status=${status}, devices=${nDevices}`);

    if (nDevices > 0 && data.length >= 12 + 312) {
      const vid = data.readUInt16BE(12 + 300);
      const pid = data.readUInt16BE(12 + 302);
      const busid = data.slice(12 + 256, 12 + 288).toString('utf8').replace(/\0+$/, '');
      console.log(`장치: VID=0x${vid.toString(16).toUpperCase()}, PID=0x${pid.toString(16).toUpperCase()}, busid=${busid}`);

      const ifClass = data[12 + 312];
      const ifSubClass = data[12 + 313];
      const ifProto = data[12 + 314];
      console.log(`인터페이스: class=0x${ifClass.toString(16)}(HID), subclass=0x${ifSubClass.toString(16)}(Boot), proto=0x${ifProto.toString(16)}(Mouse)`);
    }

    client1.end();

    // 3) OP_REQ_IMPORT 테스트
    setTimeout(() => {
      console.log('\n--- TEST 2: OP_REQ_IMPORT ---');
      const client2 = net.connect(13240, '127.0.0.1', () => {
        const req = Buffer.alloc(40, 0);
        req.writeUInt16BE(0x0111, 0);
        req.writeUInt16BE(0x8003, 2);  // OP_REQ_IMPORT
        req.writeUInt32BE(0, 4);
        req.write('1-1', 8, 'utf8');   // busid
        client2.write(req);
      });

      client2.on('data', (data) => {
        console.log(`응답 크기: ${data.length} bytes`);
        if (data.length >= 8) {
          const version = data.readUInt16BE(0);
          const command = data.readUInt16BE(2);
          const status = data.readUInt32BE(4);
          console.log(`version=0x${version.toString(16)}, command=0x${command.toString(16)}, status=${status}`);

          if (status === 0 && data.length >= 320) {
            const vid = data.readUInt16BE(8 + 300);
            const pid = data.readUInt16BE(8 + 302);
            console.log(`Import 성공: VID=0x${vid.toString(16).toUpperCase()}, PID=0x${pid.toString(16).toUpperCase()}`);
            console.log(`isAttached: ${hidServer.isDeviceAttached()}`);

            // 4) 마우스 리포트 테스트 (가상 전송)
            console.log('\n--- TEST 3: 마우스 리포트 ---');

            // CMD_SUBMIT (Interrupt IN, EP1) 시뮬레이션
            const urbReq = Buffer.alloc(48, 0);
            urbReq.writeUInt32BE(0x00000001, 0);  // CMD_SUBMIT
            urbReq.writeUInt32BE(1, 4);            // seqnum
            urbReq.writeUInt32BE((1 << 16) | 2, 8); // devid
            urbReq.writeUInt32BE(1, 12);           // direction IN
            urbReq.writeUInt32BE(1, 16);           // ep 1
            urbReq.writeUInt32BE(0, 20);           // transfer_flags
            urbReq.writeUInt32BE(4, 24);           // transfer_buffer_length
            urbReq.writeUInt32BE(0xFFFFFFFF, 32);  // number_of_packets
            client2.write(urbReq);

            // 500ms 후 마우스 이동 전송
            setTimeout(() => {
              const sent = hidServer.sendMouseReport(0, 10, -5, 0);
              console.log(`마우스 리포트 전송: ${sent ? '성공 ✅' : '실패 ❌'}`);
            }, 500);
          }
        }
      });

      client2.on('data', (data) => {
        // RET_SUBMIT 응답 확인
        if (data.length >= 48) {
          const cmd = data.readUInt32BE(0);
          if (cmd === 0x00000003) {
            const actualLen = data.readUInt32BE(24);
            if (actualLen > 0 && data.length >= 48 + actualLen) {
              const report = data.slice(48, 48 + actualLen);
              console.log(`마우스 리포트 수신: buttons=${report[0]}, dx=${report.readInt8(1)}, dy=${report.readInt8(2)}, wheel=${report.readInt8(3)}`);
              console.log('\n=== 모든 테스트 통과 ✅ ===');
              client2.end();
              setTimeout(() => {
                hidServer.stopServer();
                process.exit(0);
              }, 500);
            }
          }
        }
      });

      client2.on('error', (e) => console.log('client2 에러:', e.message));

    }, 500);
  });

  client1.on('error', (e) => console.log('client1 에러:', e.message));

}, 1000);
