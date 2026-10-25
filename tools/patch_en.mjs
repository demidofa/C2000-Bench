import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';
import fs from 'fs';
const [,, exe, ico] = process.argv;
const pe = PELibrary.NtExecutable.from(fs.readFileSync(exe));
const res = PELibrary.NtExecutableResource.from(pe);
const icon = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icon.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(1, 0, 0, 0); vi.setProductVersion(1, 0, 0, 0);
const lang = { lang: 1033, codepage: 1200 };
vi.setStringValues(lang, {
  FileDescription: 'C2000 Bench - training simulator of TMS320F2837xD',
  ProductName: 'C2000 Bench', CompanyName: 'ITMO University',
  FileVersion: '1.0.0', ProductVersion: '1.0.0',
  OriginalFilename: 'C2000Bench.exe', InternalName: 'C2000Bench', LegalCopyright: 'ITMO University, 2026'
});
vi.outputToResourceEntries(res.entries);
res.outputResource(pe);
fs.writeFileSync(exe, Buffer.from(pe.generate()));
console.log('patched', fs.statSync(exe).size);
