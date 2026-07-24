// database/seed.js
// Optional helper to populate demo categories & nominees so you can see
// the site working immediately. Run with: npm run seed

const { db, initDatabase } = require('./db');

initDatabase();

const categories = [
  {
    name: 'Best Male Artist',
    description: 'Recognizing outstanding achievement by a male artist this year.',
    nominees: ['Daniel Osei', 'Marcus Reid', 'Kwame Asante']
  },
  {
    name: 'Best Female Artist',
    description: 'Recognizing outstanding achievement by a female artist this year.',
    nominees: ['Amara Johnson', 'Priya Sharma', 'Sofia Mensah']
  },
  {
    name: 'Song of the Year',
    description: 'The single track that defined the year.',
    nominees: ['Midnight Echoes', 'Golden Hour', 'Electric Skyline']
  }
];

const insertCategory = db.prepare('INSERT INTO categories (name, description, display_order) VALUES (?, ?, ?)');
const insertNominee = db.prepare('INSERT INTO nominees (category_id, name, bio, display_order) VALUES (?, ?, ?, ?)');

const seedTx = db.transaction(() => {
  categories.forEach((cat, i) => {
    const info = insertCategory.run(cat.name, cat.description, i);
    cat.nominees.forEach((nomineeName, j) => {
      insertNominee.run(info.lastInsertRowid, nomineeName, `Nominated for ${cat.name}.`, j);
    });
  });
});

seedTx();
console.log('✔ Demo categories and nominees seeded successfully.');
