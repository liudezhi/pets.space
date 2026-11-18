import flower from 'bootstrap-icons/icons/flower2.svg?raw';
import map from 'bootstrap-icons/icons/map.svg?raw';
import book from 'bootstrap-icons/icons/book.svg?raw';
import walk from 'bootstrap-icons/icons/person-walking.svg?raw';
import pin from 'bootstrap-icons/icons/geo-alt.svg?raw';
import right from 'bootstrap-icons/icons/arrow-right.svg?raw';
import left from 'bootstrap-icons/icons/arrow-left.svg?raw';
import upRight from 'bootstrap-icons/icons/arrow-up-right.svg?raw';
import close from 'bootstrap-icons/icons/x-lg.svg?raw';

const icons = { flower, map, book, walk, pin, right, left, upRight, close };
export function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = icons[element.dataset.icon];
  });
}
