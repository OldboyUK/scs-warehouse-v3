const app = document.getElementById('app');

function showMenu() {
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:15px;">
      <a href="add-third-party-product.html" class="btn btn-primary">Add Third Party Product</a>
    </div>
  `;
}

showMenu();
