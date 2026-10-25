import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';
import fs from 'fs';
const [,, exe, ico] = process.argv;
const pe = PELibrary.NtExecutable.from(fs.readFileSync(exe));
const res = PELibrary.NtExecutableResource.from(pe);
const icon = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1049, icon.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(1, 0, 0, 0); vi.setProductVersion(1, 0, 0, 0);
const lang = { lang: 1049, codepage: 1200 };
vi.setStringValues(lang, {
  FileDescription: 'Стенд C2000 - учебный симулятор TMS320F2837xD',
  ProductName: 'Стенд C2000', CompanyName: 'ЦИСЭ, Университет ИТМО',
  FileVersion: '1.0.0', ProductVersion: '1.0.0',
  OriginalFilename: 'StendC2000.exe', InternalName: 'StendC2000', LegalCopyright: 'ЦИСЭ ИТМО, 2026'
});
vi.outputToResourceEntries(res.entries);
res.outputResource(pe);
fs.writeFileSync(exe, Buffer.from(pe.generate()));
console.log('patched', fs.statSync(exe).size);
