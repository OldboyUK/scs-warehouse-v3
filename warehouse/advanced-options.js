const app = document.getElementById('app');

const ADMIN_MENU_ITEMS = [
  { label: 'Add Third Party Product', href: 'add-third-party-product.html' }
];

function showMenu() {
  app.innerHTML = `
    <div class="menu-category-links">
      ${ADMIN_MENU_ITEMS.map(item =>
        `<a href="${item.href}" class="dash-card">
          <span class="dash-card-title">${item.label}</span>
        </a>`
      ).join('')}
    </div>
  `;
}

showMenu();
