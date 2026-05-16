'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataEngine = require('../../app/runtime-dist/data-engine');

const ENGINE_KINDS = ['ts'];
const nativeAddonPath = path.join(
  __dirname,
  '..',
  '..',
  'app',
  'native-dist',
  'jable_data_engine.' + process.platform + '-' + process.arch + '.node'
);

if (process.env.JABLE_TEST_RUST_ENGINE === '1' || fs.existsSync(nativeAddonPath)) {
  ENGINE_KINDS.push('rust');
}

function createEngine(t, kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-engine-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const previousKind = process.env.JABLE_DATA_ENGINE;

  process.env.JABLE_DATA_ENGINE = kind;
  const engine = dataEngine.createDataEngine(dbPath);

  t.after(function () {
    engine.close();
    if (typeof previousKind === 'undefined') delete process.env.JABLE_DATA_ENGINE;
    else process.env.JABLE_DATA_ENGINE = previousKind;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return { dir, engine };
}

function withoutExportedAt(resource) {
  const copy = JSON.parse(JSON.stringify(resource));

  if (copy.meta) delete copy.meta.exported_at;
  if (Array.isArray(copy.data)) {
    for (let i = 0; i < copy.data.length; i++) {
      if (copy.data[i] && copy.data[i].meta) delete copy.data[i].meta.exported_at;
    }
  }

  return copy;
}

for (const kind of ENGINE_KINDS) {
  test('data engine contract: sync pages and list queries (' + kind + ')', function (t) {
    const { engine } = createEngine(t, kind);

    engine.saveSyncPage({
      collectionKey: 'favourites',
      mode: 'full',
      syncRunId: 'contract-run',
      page: 1,
      url: 'https://jable.tv/my/favourites/videos/',
      rows: [
        {
          title: 'Second',
          url: 'https://jable.tv/videos/second/',
          views: 20,
          likes: 2,
          siteOrder: 2
        },
        {
          title: 'First',
          url: 'https://jable.tv/videos/first/',
          views: 10,
          likes: 1,
          siteOrder: 1
        }
      ]
    });

    assert.equal(engine.countVideos('favourites'), 2);
    assert.deepEqual(
      engine.listVideos('favourites').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/first/', 'https://jable.tv/videos/second/']
    );
    assert.equal(engine.allCollectionUrlsKnown('favourites', ['https://fs1.app/videos/first/?source=contract']), true);
  });

  test('data engine contract: operation outbox and finish sync ordering (' + kind + ')', function (t) {
    const { engine } = createEngine(t, kind);
    const syncRunId = 'contract-full-run';

    engine.saveSyncPage({
      collectionKey: 'favourites',
      mode: 'full',
      syncRunId: syncRunId,
      page: 1,
      url: 'https://jable.tv/my/favourites/videos/',
      rows: [
        { title: 'Alpha', url: 'https://jable.tv/videos/alpha/', siteOrder: 1 },
        { title: 'Beta', url: 'https://jable.tv/videos/beta/', siteOrder: 2 },
        { title: 'Gamma', url: 'https://jable.tv/videos/gamma/', siteOrder: 3 }
      ]
    });
    engine.applyCollectionToggle({
      collectionKey: 'favourites',
      action: 'remove',
      syncRunId: syncRunId,
      deferRemote: true,
      remoteVideoId: '2',
      remoteFavType: '0',
      video: { title: 'Beta', url: 'https://jable.tv/videos/beta/' }
    });
    engine.applyCollectionToggle({
      collectionKey: 'favourites',
      action: 'add',
      syncRunId: syncRunId,
      deferRemote: true,
      remoteVideoId: '4',
      remoteFavType: '0',
      video: { title: 'Delta', url: 'https://jable.tv/videos/delta/' }
    });

    const outbox = engine.listDeferredSyncOutboxOperations('favourites');
    assert.deepEqual(
      outbox.map(function (operation) {
        return operation.action + ':' + operation.videoUrl;
      }),
      ['remove:https://jable.tv/videos/beta/', 'add:https://jable.tv/videos/delta/']
    );

    const state = engine.finishSync({
      collectionKey: 'favourites',
      mode: 'full',
      syncRunId: syncRunId,
      result: {
        completed: true,
        mode: 'full',
        syncRunId: syncRunId,
        incompleteReason: null,
        stoppedByKnownPage: false,
        totalPages: 1,
        totalRows: 3,
        lastScrapedPage: 1,
        lastKnownUrl: 'https://jable.tv/videos/gamma/'
      }
    });

    assert.equal(state.completed, true);
    assert.equal(state.mutationsReconciled, 2);
    assert.deepEqual(
      engine.listVideos('favourites').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/delta/', 'https://jable.tv/videos/alpha/', 'https://jable.tv/videos/gamma/']
    );
    assert.equal(engine.markDeferredSyncOperationsApplied('favourites', null, [outbox[0].id]), 1);
    assert.equal(engine.markDeferredSyncOperationFailed('favourites', null, outbox[1].id, 'Temporary failure'), true);
    assert.deepEqual(
      engine.listDeferredSyncOutboxOperations('favourites').map(function (operation) {
        return operation.videoUrl;
      }),
      ['https://jable.tv/videos/delta/']
    );
  });

  test('data engine contract: import and streamed export (' + kind + ')', async function (t) {
    const { dir, engine } = createEngine(t, kind);
    const filePath = path.join(dir, 'export.json');

    const imported = engine.importResource('watch_later', {
      data: [
        {
          data: [
            { title: 'Watch 1', url: 'https://jable.tv/videos/watch-1/', site_order: 2 },
            { title: 'Watch 2', url: 'https://jable.tv/videos/watch-2/', site_order: 1 }
          ],
          meta: { current_page: 1 }
        }
      ],
      meta: {
        completed: true,
        last_scraped_page: 1
      }
    });

    assert.deepEqual(imported, { imported: 2, collectionKey: 'watch_later' });
    assert.deepEqual(
      engine.listVideos('watch_later').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/watch-2/', 'https://jable.tv/videos/watch-1/']
    );

    const expected = engine.exportResource('watch_later');
    const result = await engine.exportResourceToFile('watch_later', filePath);
    const actual = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    assert.equal(result.total, 2);
    assert.deepEqual(withoutExportedAt(actual), withoutExportedAt(expected));
  });
}

test('data engine defaults to rust when the native addon is available', function (t) {
  if (!fs.existsSync(nativeAddonPath)) {
    t.skip('native data engine addon is not built');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-engine-default-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const previousKind = process.env.JABLE_DATA_ENGINE;
  delete process.env.JABLE_DATA_ENGINE;

  const engine = dataEngine.createDataEngine(dbPath);

  t.after(function () {
    engine.close();
    if (typeof previousKind === 'undefined') delete process.env.JABLE_DATA_ENGINE;
    else process.env.JABLE_DATA_ENGINE = previousKind;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(engine.constructor.name, 'RustDataEngine');
});
