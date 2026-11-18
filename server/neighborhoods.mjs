// A six-plot clearing has stable addresses. Removing or hiding a memorial never
// slides the neighbouring stones into different positions.
export function createNeighborhoods(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plot_addresses (
      number INTEGER PRIMARY KEY AUTOINCREMENT,
      garden TEXT NOT NULL UNIQUE REFERENCES gardens(id) ON DELETE CASCADE
    );
    INSERT INTO plot_addresses(garden) SELECT id FROM gardens g
      WHERE id<>'demo-riverbend' AND NOT EXISTS(SELECT 1 FROM plot_addresses p WHERE p.garden=g.id) ORDER BY g.rowid;
    CREATE TRIGGER IF NOT EXISTS assign_plot AFTER INSERT ON gardens WHEN NEW.id<>'demo-riverbend'
      BEGIN INSERT INTO plot_addresses(garden) VALUES(NEW.id); END;
  `);
  const publicPlots = ' FROM plot_addresses p JOIN gardens g ON g.id=p.garden WHERE g.is_public=1';
  const available = db.prepare(
    'SELECT DISTINCT CAST((p.number-1)/6 AS INTEGER) AS page' + publicPlots + ' ORDER BY page',
  );
  const plots = db.prepare(
    'SELECT g.id,g.name,g.place,(p.number-1)%6 AS slot' +
      publicPlots +
      ' AND p.number BETWEEN ? AND ? ORDER BY p.number',
  );
  const sample = db.prepare(
    "SELECT id,name,place,0 AS slot FROM gardens WHERE id='demo-riverbend' AND is_public=1",
  );
  return function getNeighborhood(requested = 0) {
    const pages = available.all().map((row) => row.page);
    const page = pages.includes(requested) ? requested : (pages[0] ?? 0);
    const i = pages.indexOf(page);
    const rows = pages.length ? plots.all(page * 6 + 1, page * 6 + 6) : sample.all();
    return {
      page,
      previous: pages[i - 1] ?? null,
      next: pages[i + 1] ?? null,
      gardens: rows.map((row) => ({ ...row, photoUrl: '/api/gardens/' + row.id + '/photo' })),
    };
  };
}
