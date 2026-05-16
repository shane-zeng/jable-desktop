'use strict';

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

module.exports = {
  withoutExportedAt
};
