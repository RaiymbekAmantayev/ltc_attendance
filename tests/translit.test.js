const { test } = require('node:test');
const assert = require('node:assert/strict');
const translit = require('../src/lib/translit');

test('транслитерация ФИО: русские и казахские буквы, регистр, латиница без изменений', () => {
  assert.equal(translit('Сабина Жумабаева'), 'Sabina Zhumabaeva');
  assert.equal(translit('Данияр Тулеубеков'), 'Daniyar Tuleubekov');
  assert.equal(translit('Әлихан Құрманғали'), 'Alikhan Kurmangali');
  assert.equal(translit('Щукин Юрий'), 'Shchukin Yuriy');
  assert.equal(translit('ЖАННА Ш.'), 'ZHANNA Sh.');
  assert.equal(translit('Emma Davis'), 'Emma Davis');
  assert.equal(translit(null), '');
});
