'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataEngine = require('../../app/runtime-dist/data-engine');
const { withoutExportedAt } = require('./helpers/export-resource');

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
      deferLocal: true,
      remoteVideoId: '2',
      remoteFavType: '0',
      video: { title: 'Beta', url: 'https://jable.tv/videos/beta/' }
    });
    engine.applyCollectionToggle({
      collectionKey: 'favourites',
      action: 'add',
      syncRunId: syncRunId,
      deferRemote: true,
      deferLocal: true,
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
    assert.deepEqual(
      engine.listVideos('favourites').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/alpha/', 'https://jable.tv/videos/beta/', 'https://jable.tv/videos/gamma/']
    );
    assert.equal(
      engine.markDeferredSyncOperationsApplied(
        'favourites',
        null,
        outbox.map(function (operation) {
          return operation.id;
        })
      ),
      2
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
    assert.equal(engine.listDeferredSyncOutboxOperations('favourites').length, 0);
    assert.equal(engine.listPendingRemoteOperationGroups().length, 0);
  });

  test('data engine contract: deferred local operations wait for remote resolution (' + kind + ')', function (t) {
    const { engine } = createEngine(t, kind);

    engine.saveSyncPage({
      collectionKey: 'favourites',
      mode: 'full',
      syncRunId: 'defer-local-remove',
      page: 1,
      url: 'https://jable.tv/my/favourites/videos/',
      rows: [{ title: 'Keep Local', url: 'https://jable.tv/videos/keep-local/', siteOrder: 1 }]
    });

    const removeResult = engine.applyCollectionToggle({
      collectionKey: 'favourites',
      action: 'remove',
      syncRunId: 'defer-local-remove',
      deferRemote: true,
      deferLocal: true,
      remoteVideoId: '30',
      remoteFavType: '0',
      video: { title: 'Keep Local', url: 'https://jable.tv/videos/keep-local/' }
    });
    assert.equal(removeResult.queued, true);
    assert.equal(removeResult.changed, false);
    assert.equal(removeResult.visible, true);
    assert.deepEqual(
      engine.listVideos('favourites').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/keep-local/']
    );

    const removeState = engine.finishSync({
      collectionKey: 'favourites',
      mode: 'full',
      syncRunId: 'defer-local-remove',
      result: {
        completed: true,
        mode: 'full',
        syncRunId: 'defer-local-remove',
        incompleteReason: null,
        stoppedByKnownPage: false,
        totalPages: 1,
        totalRows: 1,
        lastScrapedPage: 1,
        lastKnownUrl: 'https://jable.tv/videos/keep-local/',
        queuedOperationsSkipped: 1
      }
    });
    assert.equal(removeState.mutationsReconciled, 1);
    assert.deepEqual(
      engine.listVideos('favourites').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/keep-local/']
    );

    let groups = engine.listPendingRemoteOperationGroups();
    assert.equal(groups.length, 1);
    assert.equal(engine.markPendingRemoteOperationGroupResolved(groups[0].groupId), true);
    assert.deepEqual(
      engine.listVideos('favourites').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/keep-local/']
    );

    engine.applyCollectionToggle({
      collectionKey: 'favourites',
      action: 'remove',
      syncRunId: 'defer-local-remove-success',
      deferRemote: true,
      deferLocal: true,
      remoteVideoId: '30',
      remoteFavType: '0',
      video: { title: 'Keep Local', url: 'https://jable.tv/videos/keep-local/' }
    });
    engine.finishSync({
      collectionKey: 'favourites',
      mode: 'full',
      syncRunId: 'defer-local-remove-success',
      result: {
        completed: true,
        mode: 'full',
        syncRunId: 'defer-local-remove-success',
        incompleteReason: null,
        stoppedByKnownPage: false,
        totalPages: 1,
        totalRows: 1,
        lastScrapedPage: 1,
        lastKnownUrl: 'https://jable.tv/videos/keep-local/',
        queuedOperationsSkipped: 1
      }
    });
    groups = engine.listPendingRemoteOperationGroups();
    const removeGroup = groups.find(function (group) {
      return group.videoUrl === 'https://jable.tv/videos/keep-local/';
    });
    assert.ok(removeGroup);
    assert.equal(engine.markPendingRemoteOperationGroupRemoved(removeGroup.groupId), true);
    assert.equal(engine.listVideos('favourites').length, 0);

    const addResult = engine.applyCollectionToggle({
      collectionKey: 'watch_later',
      action: 'add',
      syncRunId: 'defer-local-add',
      deferRemote: true,
      deferLocal: true,
      remoteVideoId: '31',
      remoteFavType: '1',
      video: { title: 'Add Later', url: 'https://jable.tv/videos/add-later/' }
    });
    assert.equal(addResult.queued, true);
    assert.equal(addResult.changed, false);
    assert.equal(addResult.visible, false);
    assert.equal(engine.listVideos('watch_later').length, 0);

    engine.finishSync({
      collectionKey: 'watch_later',
      mode: 'full',
      syncRunId: 'defer-local-add',
      result: {
        completed: true,
        mode: 'full',
        syncRunId: 'defer-local-add',
        incompleteReason: null,
        stoppedByKnownPage: false,
        totalPages: 1,
        totalRows: 0,
        lastScrapedPage: 1,
        lastKnownUrl: null,
        queuedOperationsSkipped: 1
      }
    });
    assert.equal(engine.listVideos('watch_later').length, 0);

    groups = engine.listPendingRemoteOperationGroups();
    const addGroup = groups.find(function (group) {
      return group.videoUrl === 'https://jable.tv/videos/add-later/';
    });
    assert.ok(addGroup);
    assert.equal(engine.markPendingRemoteOperationGroupAdded(addGroup.groupId), true);
    assert.deepEqual(
      engine.listVideos('watch_later').map(function (row) {
        return row.url;
      }),
      ['https://jable.tv/videos/add-later/']
    );
  });

  test(
    'data engine contract: pending remote groups keep operation sequence and full sync supersedes old failures (' +
      kind +
      ')',
    function (t) {
      const { engine } = createEngine(t, kind);
      const syncRunId = 'pending-final-intent';

      engine.applyCollectionToggle({
        collectionKey: 'watch_later',
        action: 'add',
        syncRunId: syncRunId,
        deferRemote: true,
        remoteVideoId: '10',
        remoteFavType: '1',
        video: { title: 'Flip', url: 'https://jable.tv/videos/flip/' }
      });
      engine.applyCollectionToggle({
        collectionKey: 'watch_later',
        action: 'remove',
        syncRunId: syncRunId,
        deferRemote: true,
        remoteVideoId: '10',
        remoteFavType: '1',
        video: { title: 'Flip', url: 'https://jable.tv/videos/flip/' }
      });
      engine.applyCollectionToggle({
        collectionKey: 'watch_later',
        action: 'add',
        syncRunId: syncRunId,
        deferRemote: true,
        remoteVideoId: '10',
        remoteFavType: '1',
        video: { title: 'Flip', url: 'https://jable.tv/videos/flip/' }
      });

      const outbox = engine.listDeferredSyncOutboxOperations('watch_later');
      assert.equal(engine.markDeferredSyncOperationFailed('watch_later', null, outbox[0].id, 'HTTP 500'), true);
      engine.applyCollectionToggle({
        collectionKey: 'watch_later',
        action: 'add',
        syncRunId: 'older-pending-run',
        deferRemote: true,
        remoteVideoId: '11',
        remoteFavType: '1',
        video: { title: 'Old Pending', url: 'https://jable.tv/videos/old-pending/' }
      });

      let groups = engine.listPendingRemoteOperationGroups();
      assert.equal(groups.length, 2);
      const failedGroup = groups.find(function (group) {
        return group.videoUrl === 'https://jable.tv/videos/flip/';
      });
      assert.ok(failedGroup);
      assert.equal(failedGroup.operationCount, 3);
      assert.deepEqual(
        failedGroup.sequence.map(function (step) {
          return step.action + ':' + step.state;
        }),
        ['add:failed', 'remove:blocked', 'add:blocked']
      );
      const pendingGroup = groups.find(function (group) {
        return group.videoUrl === 'https://jable.tv/videos/old-pending/';
      });
      assert.ok(pendingGroup);
      assert.equal(pendingGroup.state, 'pending');

      engine.finishSync({
        collectionKey: 'watch_later',
        mode: 'full',
        syncRunId: 'clean-full-run',
        result: {
          completed: true,
          mode: 'full',
          syncRunId: 'clean-full-run',
          incompleteReason: null,
          stoppedByKnownPage: false,
          totalPages: 1,
          totalRows: 0,
          lastScrapedPage: 1,
          lastKnownUrl: null,
          queuedOperationsFailed: 0
        }
      });

      groups = engine.listPendingRemoteOperationGroups();
      assert.equal(groups.length, 0);
    }
  );

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
