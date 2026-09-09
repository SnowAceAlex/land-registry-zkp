import * as unzipper from 'unzipper';

import { ArchiveService } from './archive.service';
import { ZipService } from './zip.service';

describe('ArchiveService (D42)', () => {
  const service = new ArchiveService(new ZipService());

  const filesFor = (id: string) => [
    { name: 'receipt.json', content: `{"propertyId":"${id}"}` },
    { name: 'secret.json', content: '{"ownerSecret":"42"}' },
    { name: 'certificate.pdf', content: Buffer.from('%PDF-1.7') },
    { name: 'README.txt', content: 'huong dan' },
  ];

  const input = {
    batchId: 3,
    rootVersion: 7,
    txHash: '0xabc',
    publishedAt: new Date('2026-09-07T10:00:00Z'),
    entries: [
      { propertyId: '1001', certificateSerial: 'AA-001', leaf: '555', files: filesFor('1001') },
      { propertyId: '1002', certificateSerial: 'AA-002', leaf: '666', files: filesFor('1002') },
    ],
  };

  const namesOf = async (zip: Buffer) => {
    const directory = await unzipper.Open.buffer(zip);
    return directory.files.map((f) => f.path).sort();
  };

  it('puts each property in its own folder, keeping every bundle file', async () => {
    expect(await namesOf(await service.build(input))).toEqual([
      '1001/README.txt',
      '1001/certificate.pdf',
      '1001/receipt.json',
      '1001/secret.json',
      '1002/README.txt',
      '1002/certificate.pdf',
      '1002/receipt.json',
      '1002/secret.json',
      'manifest.json',
    ]);
  });

  it('keeps each plot content inside its own folder', async () => {
    const directory = await unzipper.Open.buffer(await service.build(input));
    const receipt = directory.files.find((f) => f.path === '1002/receipt.json')!;
    expect((await receipt.buffer()).toString()).toBe('{"propertyId":"1002"}');
  });

  it('writes a manifest that ties the archive to a specific root version', async () => {
    const directory = await unzipper.Open.buffer(await service.build(input));
    const manifestFile = directory.files.find((f) => f.path === 'manifest.json')!;

    expect(JSON.parse((await manifestFile.buffer()).toString())).toEqual({
      batchId: 3,
      rootVersion: 7,
      txHash: '0xabc',
      publishedAt: '2026-09-07T10:00:00.000Z',
      properties: [
        { propertyId: '1001', certificateSerial: 'AA-001', leaf: '555' },
        { propertyId: '1002', certificateSerial: 'AA-002', leaf: '666' },
      ],
    });
  });
});
