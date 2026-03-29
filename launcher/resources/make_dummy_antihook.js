const fs = require('fs');
const path = require('path');

const FILE_ALIGNMENT = 0x200;
const SECTION_ALIGNMENT = 0x1000;
const buf = Buffer.alloc(0x600, 0);

// === DOS Header ===
buf.write('MZ', 0);
buf.writeUInt32LE(0x80, 0x3C); // e_lfanew

// === PE Signature ===
buf.write('PE\0\0', 0x80);

// === COFF File Header === (at 0x84)
const c = 0x84;
buf.writeUInt16LE(0x8664, c);        // Machine: AMD64
buf.writeUInt16LE(2, c + 2);         // NumberOfSections
buf.writeUInt16LE(240, c + 16);      // SizeOfOptionalHeader (PE32+)
buf.writeUInt16LE(0x2022, c + 18);   // Characteristics: DLL | EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

// === Optional Header (PE32+) === (at 0x98)
const o = 0x98;
buf.writeUInt16LE(0x020B, o);              // Magic: PE32+
buf[o + 2] = 1;                            // MajorLinkerVersion
buf.writeUInt32LE(0x200, o + 4);           // SizeOfCode
buf.writeUInt32LE(0x200, o + 8);           // SizeOfInitializedData
buf.writeUInt32LE(0x1000, o + 16);         // AddressOfEntryPoint (DllMain)
buf.writeUInt32LE(0x1000, o + 20);         // BaseOfCode
buf.writeUInt32LE(0x10000000, o + 24);     // ImageBase (low)
buf.writeUInt32LE(0, o + 28);              // ImageBase (high)
buf.writeUInt32LE(SECTION_ALIGNMENT, o + 32);
buf.writeUInt32LE(FILE_ALIGNMENT, o + 36);
buf.writeUInt16LE(6, o + 40);              // MajorOSVersion
buf.writeUInt16LE(6, o + 48);              // MajorSubsystemVersion
buf.writeUInt32LE(0x3000, o + 56);         // SizeOfImage
buf.writeUInt32LE(0x200, o + 60);          // SizeOfHeaders
buf.writeUInt16LE(2, o + 68);              // Subsystem: WINDOWS_GUI
buf.writeUInt16LE(0x0160, o + 70);         // DllCharacteristics: DYNAMIC_BASE|NX_COMPAT|NO_SEH
buf.writeUInt32LE(0x100000, o + 72);       // SizeOfStackReserve
buf.writeUInt32LE(0x1000, o + 80);         // SizeOfStackCommit
buf.writeUInt32LE(0x100000, o + 88);       // SizeOfHeapReserve
buf.writeUInt32LE(0x1000, o + 96);         // SizeOfHeapCommit
buf.writeUInt32LE(16, o + 108);            // NumberOfRvaAndSizes

// Data Directory [0] Export Table
const dd = o + 112;
buf.writeUInt32LE(0x2000, dd);       // Export RVA
buf.writeUInt32LE(0x100, dd + 4);    // Export Size

// === Section Headers === (at 0x188)
const s1 = 0x188;
buf.write('.text\0\0\0', s1);
buf.writeUInt32LE(0x10, s1 + 8);            // VirtualSize
buf.writeUInt32LE(0x1000, s1 + 12);         // VirtualAddress
buf.writeUInt32LE(0x200, s1 + 16);          // SizeOfRawData
buf.writeUInt32LE(0x200, s1 + 20);          // PointerToRawData
buf.writeUInt32LE(0x60000020, s1 + 36);     // CODE|EXECUTE|READ

const s2 = s1 + 40;
buf.write('.edata\0\0', s2);
buf.writeUInt32LE(0x100, s2 + 8);           // VirtualSize
buf.writeUInt32LE(0x2000, s2 + 12);         // VirtualAddress
buf.writeUInt32LE(0x200, s2 + 16);          // SizeOfRawData
buf.writeUInt32LE(0x400, s2 + 20);          // PointerToRawData
buf.writeUInt32LE(0x40000040, s2 + 36);     // INITIALIZED_DATA|READ

// === .text section === (file offset 0x200)
// DllMain: mov eax, 1; ret (returns TRUE)
buf[0x200] = 0xB8;
buf[0x201] = 0x01; buf[0x202] = 0x00; buf[0x203] = 0x00; buf[0x204] = 0x00;
buf[0x205] = 0xC3;

// AntiHookingDummyImport: xor eax, eax; ret (returns 0, does nothing)
buf[0x206] = 0x31;
buf[0x207] = 0xC0;
buf[0x208] = 0xC3;

// === .edata section === (file offset 0x400, RVA 0x2000)
const e = 0x400;
const eRVA = 0x2000;

// Export Directory (40 bytes)
buf.writeUInt32LE(eRVA + 0x34, e + 12);     // Name RVA -> "AntiHooking.dll"
buf.writeUInt32LE(1, e + 16);                // OrdinalBase
buf.writeUInt32LE(1, e + 20);                // NumberOfFunctions
buf.writeUInt32LE(1, e + 24);                // NumberOfNames
buf.writeUInt32LE(eRVA + 0x28, e + 28);     // AddressOfFunctions
buf.writeUInt32LE(eRVA + 0x2C, e + 32);     // AddressOfNames
buf.writeUInt32LE(eRVA + 0x30, e + 36);     // AddressOfNameOrdinals

// Function address array
buf.writeUInt32LE(0x1006, e + 0x28);        // RVA of AntiHookingDummyImport

// Name pointer array
buf.writeUInt32LE(eRVA + 0x44, e + 0x2C);   // RVA of function name string

// Ordinal array
buf.writeUInt16LE(0, e + 0x30);

// DLL name
buf.write('AntiHooking.dll\0', e + 0x34);

// Function name
buf.write('AntiHookingDummyImport\0', e + 0x44);

// Write output
const outPath = path.join(__dirname, 'AntiHooking_dummy.dll');
fs.writeFileSync(outPath, buf.slice(0, 0x600));
console.log('Dummy DLL created:', outPath, '(' + buf.slice(0, 0x600).length + ' bytes)');
