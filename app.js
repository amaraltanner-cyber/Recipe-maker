const MEAL_TYPES = ['all', 'breakfast', 'lunch', 'dinner', 'snack'];
const DEVICES = ['stovetop', 'oven', 'air-fryer', 'no-cook', 'microwave'];
const DEVICE_LABELS = {
  'stovetop': 'Stovetop',
  'oven': 'Oven',
  'air-fryer': 'Air Fryer',
  'no-cook': 'No-Cook',
  'microwave': 'Microwave'
};

const CATEGORY_ORDER = ['produce', 'meat-seafood', 'dairy-eggs', 'pantry-dry-goods', 'condiments-sauces-spices'];
const CATEGORY_LABELS = {
  'produce': 'Produce',
  'meat-seafood': 'Meat & Seafood',
  'dairy-eggs': 'Dairy & Eggs',
  'pantry-dry-goods': 'Pantry & Dry Goods',
  'condiments-sauces-spices': 'Condiments & Spices'
};

const PROTEIN_MIN = 50;
const PROTEIN_MAX = 300;
const PROTEIN_STEP = 5;

const BUDGET_MIN = 20;
const BUDGET_MAX = 250;
const BUDGET_STEP = 5;

const STORAGE_PLAN = 'proteinApp.plan';
const STORAGE_SETTINGS = 'proteinApp.settings';
const STORAGE_GROCERY_CHECKED = 'proteinApp.groceryChecked';
const STORAGE_FAVORITES = 'proteinApp.favorites';

let RECIPES = [];

const state = {
  search: '',
  mealType: 'all',
  devices: new Set(),
  sort: 'protein-desc',
  favoritesOnly: false,
  favorites: new Set(),  // recipeId
  servingsChoice: {},   // recipeId -> pending servings (1-5) before/while in plan
  plan: {},             // recipeId -> servings
  settings: { targetProtein: 185, budgetMode: 'under', budgetTarget: 75 },
  groceryChecked: {}    // itemKey -> boolean
};

function snapToStep(value, min, max, step, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round((n - min) / step) * step + min;
  return Math.max(min, Math.min(max, snapped));
}

function loadPersisted() {
  try {
    const plan = JSON.parse(localStorage.getItem(STORAGE_PLAN));
    if (plan && typeof plan === 'object') state.plan = plan;
  } catch (e) {}
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_SETTINGS));
    if (settings && typeof settings === 'object') {
      state.settings.targetProtein = snapToStep(settings.targetProtein, PROTEIN_MIN, PROTEIN_MAX, PROTEIN_STEP, 185);
      state.settings.budgetMode = settings.budgetMode === 'around' ? 'around' : 'under';
      state.settings.budgetTarget = snapToStep(settings.budgetTarget, BUDGET_MIN, BUDGET_MAX, BUDGET_STEP, 75);
    }
  } catch (e) {}
  try {
    const checked = JSON.parse(localStorage.getItem(STORAGE_GROCERY_CHECKED));
    if (checked && typeof checked === 'object') state.groceryChecked = checked;
  } catch (e) {}
  try {
    const favorites = JSON.parse(localStorage.getItem(STORAGE_FAVORITES));
    if (Array.isArray(favorites)) state.favorites = new Set(favorites);
  } catch (e) {}
  state.servingsChoice = { ...state.plan };
}

function persistPlan() {
  localStorage.setItem(STORAGE_PLAN, JSON.stringify(state.plan));
}

function persistSettings() {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings));
}

function persistGroceryChecked() {
  localStorage.setItem(STORAGE_GROCERY_CHECKED, JSON.stringify(state.groceryChecked));
}

function persistFavorites() {
  localStorage.setItem(STORAGE_FAVORITES, JSON.stringify([...state.favorites]));
}

function toggleFavorite(recipeId) {
  if (state.favorites.has(recipeId)) state.favorites.delete(recipeId);
  else state.favorites.add(recipeId);
  persistFavorites();
  renderRecipeGrid();
}

function formatIngredientLine(qty, unit, item) {
  const qtyStr = formatQty(qty);
  if (unit.toLowerCase() === 'each') return `${qtyStr} ${item}`;
  return `${qtyStr} ${unit} ${item}`;
}

function formatQty(num) {
  const rounded = Math.round(num * 100) / 100;
  const whole = Math.floor(rounded);
  const frac = rounded - whole;
  const fractions = [
    [0.0, ''], [0.25, '1/4'], [0.33, '1/3'], [0.34, '1/3'],
    [0.5, '1/2'], [0.66, '2/3'], [0.67, '2/3'], [0.75, '3/4']
  ];
  let closest = fractions[0];
  let bestDiff = Infinity;
  for (const f of fractions) {
    const diff = Math.abs(frac - f[0]);
    if (diff < bestDiff) { bestDiff = diff; closest = f; }
  }
  if (bestDiff > 0.08) {
    return String(rounded);
  }
  if (closest[0] === 0) return whole === 0 ? '0' : String(whole);
  return whole > 0 ? `${whole} ${closest[1]}` : closest[1];
}

function getServingsFor(recipeId) {
  return state.servingsChoice[recipeId] || 1;
}

function setServingsFor(recipeId, value) {
  const clamped = Math.max(1, Math.min(5, value));
  state.servingsChoice[recipeId] = clamped;
  if (state.plan[recipeId] !== undefined) {
    state.plan[recipeId] = clamped;
    persistPlan();
    renderPlanPanel();
    renderGroceryList();
    renderBudgetSection();
  }
}

function toggleInPlan(recipeId) {
  if (state.plan[recipeId] !== undefined) {
    delete state.plan[recipeId];
  } else {
    state.plan[recipeId] = getServingsFor(recipeId);
  }
  persistPlan();
  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
  renderBudgetSection();
}

function removeFromPlan(recipeId) {
  delete state.plan[recipeId];
  persistPlan();
  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
  renderBudgetSection();
}

function clearPlan() {
  state.plan = {};
  persistPlan();
  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
  renderBudgetSection();
}

function matchesFilters(recipe) {
  if (state.favoritesOnly && !state.favorites.has(recipe.id)) return false;
  if (state.mealType !== 'all' && !recipe.mealType.includes(state.mealType)) return false;
  if (state.devices.size > 0) {
    const overlaps = recipe.device.some(d => state.devices.has(d));
    if (!overlaps) return false;
  }
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    const nameMatch = recipe.name.toLowerCase().includes(q);
    const ingredientMatch = recipe.ingredients.some(i => i.item.toLowerCase().includes(q));
    if (!nameMatch && !ingredientMatch) return false;
  }
  return true;
}

function sortRecipes(list) {
  const sorted = [...list];
  switch (state.sort) {
    case 'protein-desc':
      sorted.sort((a, b) => b.nutrition.proteinG - a.nutrition.proteinG);
      break;
    case 'calories-asc':
      sorted.sort((a, b) => a.nutrition.calories - b.nutrition.calories);
      break;
    case 'time-asc':
      sorted.sort((a, b) => a.cookTimeMinutes - b.cookTimeMinutes);
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

function renderChips() {
  const mealWrap = document.getElementById('mealTypeChips');
  mealWrap.innerHTML = '';
  MEAL_TYPES.forEach(mt => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.mealType === mt ? ' active' : '');
    chip.textContent = mt === 'all' ? 'All' : mt[0].toUpperCase() + mt.slice(1);
    chip.addEventListener('click', () => {
      state.mealType = mt;
      renderChips();
      renderRecipeGrid();
    });
    mealWrap.appendChild(chip);
  });

  const deviceWrap = document.getElementById('deviceChips');
  deviceWrap.innerHTML = '';
  DEVICES.forEach(d => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.devices.has(d) ? ' active' : '');
    chip.textContent = DEVICE_LABELS[d];
    chip.addEventListener('click', () => {
      if (state.devices.has(d)) state.devices.delete(d);
      else state.devices.add(d);
      renderChips();
      renderRecipeGrid();
    });
    deviceWrap.appendChild(chip);
  });
}

function renderRecipeCard(recipe) {
  const servings = getServingsFor(recipe.id);
  const inPlan = state.plan[recipe.id] !== undefined;
  const scaledProtein = Math.round(recipe.nutrition.proteinG * servings);
  const scaledCalories = Math.round(recipe.nutrition.calories * servings);

  const isFavorite = state.favorites.has(recipe.id);

  const card = document.createElement('div');
  card.className = 'recipe-card' + (inPlan ? ' in-plan' : '');

  const tagRow = document.createElement('div');
  tagRow.className = 'tag-row';
  [...recipe.mealType, ...recipe.device].forEach(t => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = DEVICE_LABELS[t] || t;
    tagRow.appendChild(tag);
  });

  const titleRow = document.createElement('div');
  titleRow.className = 'title-row';

  const title = document.createElement('h3');
  title.textContent = recipe.name;

  const favBtn = document.createElement('button');
  favBtn.className = 'favorite-btn' + (isFavorite ? ' active' : '');
  favBtn.setAttribute('aria-label', isFavorite ? 'Remove from favorites' : 'Add to favorites');
  favBtn.textContent = isFavorite ? '★' : '☆';
  favBtn.addEventListener('click', () => toggleFavorite(recipe.id));

  titleRow.appendChild(title);
  titleRow.appendChild(favBtn);

  const macroRow = document.createElement('div');
  macroRow.className = 'macro-row';
  macroRow.innerHTML = `
    <span class="protein">${scaledProtein}g protein</span>
    <span class="calories">${scaledCalories} cal</span>
    <span class="time">${recipe.cookTimeMinutes} min</span>
  `;

  const cardControls = document.createElement('div');
  cardControls.className = 'card-controls';

  const servingsControl = document.createElement('div');
  servingsControl.className = 'servings-control';
  servingsControl.innerHTML = `
    <button class="dec" ${servings <= 1 ? 'disabled' : ''}>−</button>
    <span class="servings-value">${servings}</span>
    <button class="inc" ${servings >= 5 ? 'disabled' : ''}>+</button>
    <span>serving${servings > 1 ? 's' : ''}</span>
  `;
  servingsControl.querySelector('.dec').addEventListener('click', () => {
    setServingsFor(recipe.id, servings - 1);
    renderRecipeGrid();
  });
  servingsControl.querySelector('.inc').addEventListener('click', () => {
    setServingsFor(recipe.id, servings + 1);
    renderRecipeGrid();
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-btn' + (inPlan ? ' in-plan' : '');
  addBtn.textContent = inPlan ? 'Remove' : '+ Add to Plan';
  addBtn.addEventListener('click', () => toggleInPlan(recipe.id));

  cardControls.appendChild(servingsControl);
  cardControls.appendChild(addBtn);

  const cardFooter = document.createElement('div');
  cardFooter.className = 'card-footer';

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Ingredients & instructions';
  details.appendChild(summary);

  const ingList = document.createElement('ul');
  ingList.className = 'ingredient-list';
  recipe.ingredients.forEach(ing => {
    const li = document.createElement('li');
    li.textContent = formatIngredientLine(ing.quantity * servings, ing.unit, ing.item);
    ingList.appendChild(li);
  });
  details.appendChild(ingList);

  const instrList = document.createElement('ol');
  instrList.className = 'instruction-list';
  recipe.instructions.forEach(step => {
    const li = document.createElement('li');
    li.textContent = step;
    instrList.appendChild(li);
  });
  details.appendChild(instrList);

  if (recipe.notes) {
    const note = document.createElement('div');
    note.className = 'recipe-note';
    note.textContent = recipe.notes;
    details.appendChild(note);
  }

  const cardBtn = document.createElement('button');
  cardBtn.className = 'link-btn recipe-card-btn';
  cardBtn.textContent = 'View recipe card';
  cardBtn.addEventListener('click', () => openRecipeCard(recipe.id));

  cardFooter.appendChild(details);
  cardFooter.appendChild(cardBtn);

  card.appendChild(tagRow);
  card.appendChild(titleRow);
  card.appendChild(macroRow);
  card.appendChild(cardControls);
  card.appendChild(cardFooter);

  return card;
}

function renderRecipeGrid() {
  const grid = document.getElementById('recipeGrid');
  const filtered = sortRecipes(RECIPES.filter(matchesFilters));
  grid.innerHTML = '';
  filtered.forEach(recipe => grid.appendChild(renderRecipeCard(recipe)));
  document.getElementById('resultCount').textContent =
    `${filtered.length} recipe${filtered.length === 1 ? '' : 's'}`;
}

function computeGoal() {
  return Math.max(0, state.settings.targetProtein);
}

function computePlanTotals() {
  let protein = 0, calories = 0;
  Object.entries(state.plan).forEach(([id, servings]) => {
    const recipe = RECIPES.find(r => r.id === id);
    if (!recipe) return;
    protein += recipe.nutrition.proteinG * servings;
    calories += recipe.nutrition.calories * servings;
  });
  return { protein: Math.round(protein), calories: Math.round(calories) };
}

function renderGoalReadout() {
  const goal = computeGoal();
  document.getElementById('goalReadout').textContent =
    `Goal: ${goal}g protein from meals/snacks today`;
}

function renderPlanPanel() {
  const listEl = document.getElementById('planList');
  const totalsEl = document.getElementById('planTotals');
  const entries = Object.entries(state.plan);

  listEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'plan-empty';
    empty.textContent = 'No recipes selected yet.';
    listEl.appendChild(empty);
  } else {
    entries.forEach(([id, servings]) => {
      const recipe = RECIPES.find(r => r.id === id);
      if (!recipe) return;
      const item = document.createElement('div');
      item.className = 'plan-item';
      const protein = Math.round(recipe.nutrition.proteinG * servings);
      const cal = Math.round(recipe.nutrition.calories * servings);
      item.innerHTML = `
        <span class="plan-item-name">${recipe.name} ${servings > 1 ? `×${servings}` : ''}</span>
        <span class="plan-item-macro">${protein}g / ${cal} cal</span>
      `;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => removeFromPlan(id));
      item.appendChild(removeBtn);
      listEl.appendChild(item);
    });
  }

  const totals = computePlanTotals();
  const goal = computeGoal();
  const pct = goal > 0 ? Math.min(100, Math.round((totals.protein / goal) * 100)) : 100;
  let statusClass = 'ok';
  if (goal > 0) {
    const ratio = totals.protein / goal;
    if (ratio < 0.7) statusClass = 'danger';
    else if (ratio < 1) statusClass = 'warn';
  }

  const remaining = goal - totals.protein;
  const statusText = remaining > 0
    ? `${remaining}g short of today's goal`
    : `Goal met — ${Math.abs(remaining)}g over`;

  totalsEl.innerHTML = `
    <div>Selected: <strong>${totals.protein}g protein</strong> / ${totals.calories} cal</div>
    <div class="progress-track"><div class="progress-fill ${statusClass}" style="width:${pct}%"></div></div>
    <div class="status-line ${statusClass}">${statusText}</div>
  `;
}

function computeGroceryList() {
  const map = {}; // key -> { category, item, unit, qty, packagePrice, packageQty }
  Object.entries(state.plan).forEach(([id, servings]) => {
    const recipe = RECIPES.find(r => r.id === id);
    if (!recipe) return;
    recipe.ingredients.forEach(ing => {
      const key = `${ing.category}|${ing.item.trim().toLowerCase()}|${ing.unit.trim().toLowerCase()}`;
      const scaledQty = ing.quantity * servings;
      if (map[key]) {
        map[key].qty += scaledQty;
      } else {
        map[key] = {
          key,
          category: ing.category,
          item: ing.item,
          unit: ing.unit,
          qty: scaledQty,
          packagePrice: ing.estPackagePrice || 0,
          packageQty: ing.estPackageQty || 1
        };
      }
    });
  });

  const grouped = {};
  Object.values(map).forEach(entry => {
    if (!grouped[entry.category]) grouped[entry.category] = [];
    grouped[entry.category].push(entry);
  });
  Object.values(grouped).forEach(list => list.sort((a, b) => a.item.localeCompare(b.item)));
  return grouped;
}

function computeGroceryCost() {
  const grouped = computeGroceryList();
  let total = 0;
  Object.values(grouped).forEach(list => {
    list.forEach(entry => {
      const packagesNeeded = Math.ceil(entry.qty / entry.packageQty);
      total += packagesNeeded * entry.packagePrice;
    });
  });
  return total;
}

function renderGroceryListInto(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const grouped = computeGroceryList();
  const hasItems = Object.keys(grouped).length > 0;

  if (!hasItems) {
    const empty = document.createElement('div');
    empty.className = 'grocery-empty';
    empty.textContent = 'Add recipes to your plan to build a grocery list.';
    container.appendChild(empty);
    return;
  }

  CATEGORY_ORDER.filter(cat => grouped[cat]).forEach(cat => {
    const section = document.createElement('div');
    section.className = 'grocery-category';
    const heading = document.createElement('h3');
    heading.textContent = CATEGORY_LABELS[cat] || cat;
    section.appendChild(heading);

    const ul = document.createElement('ul');
    grouped[cat].forEach(entry => {
      const li = document.createElement('li');
      const checked = !!state.groceryChecked[entry.key];
      const label = document.createElement('label');
      label.className = 'grocery-item' + (checked ? ' checked' : '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checked;
      checkbox.addEventListener('change', () => {
        state.groceryChecked[entry.key] = checkbox.checked;
        persistGroceryChecked();
        renderGroceryList();
      });
      const span = document.createElement('span');
      span.textContent = formatIngredientLine(entry.qty, entry.unit, entry.item);
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      ul.appendChild(li);
    });
    section.appendChild(ul);
    container.appendChild(section);
  });
}

function renderGroceryList() {
  renderGroceryListInto('groceryList');
  if (!document.getElementById('storeFinderModal').classList.contains('hidden')) {
    renderGroceryListInto('storeFinderGroceryList');
  }
}

function renderBudgetSection() {
  const total = computeGroceryCost();
  const budget = state.settings.budgetTarget;
  const mode = state.settings.budgetMode;

  document.getElementById('budgetEstimate').textContent = `Est. total: $${total.toFixed(2)}`;
  document.getElementById('budgetValueLabel').textContent = budget;

  const pct = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 0;
  let statusClass, statusText;

  if (mode === 'under') {
    if (total <= budget) {
      statusClass = 'ok';
      statusText = `$${(budget - total).toFixed(2)} under budget`;
    } else {
      statusClass = 'danger';
      statusText = `$${(total - budget).toFixed(2)} over budget`;
    }
  } else {
    const diff = total - budget;
    const diffPct = budget > 0 ? Math.abs(diff) / budget : 0;
    if (diffPct <= 0.15) statusClass = 'ok';
    else if (diffPct <= 0.30) statusClass = 'warn';
    else statusClass = 'danger';
    statusText = Math.abs(diff) < 0.005
      ? 'Right on budget'
      : diff > 0
        ? `$${diff.toFixed(2)} above target`
        : `$${Math.abs(diff).toFixed(2)} below target`;
  }

  const fill = document.getElementById('budgetProgressFill');
  fill.className = 'progress-fill ' + statusClass;
  fill.style.width = pct + '%';
  const statusEl = document.getElementById('budgetStatusLine');
  statusEl.className = 'status-line ' + statusClass;
  statusEl.textContent = statusText;
}

function buildGroceryListText() {
  const grouped = computeGroceryList();
  const lines = ['Grocery List'];
  CATEGORY_ORDER.filter(cat => grouped[cat]).forEach(cat => {
    lines.push('', CATEGORY_LABELS[cat] || cat);
    grouped[cat].forEach(entry => {
      const checked = !!state.groceryChecked[entry.key];
      const box = checked ? '[x]' : '[ ]';
      lines.push(`${box} ${formatIngredientLine(entry.qty, entry.unit, entry.item)}`);
    });
  });
  lines.push('', `Estimated total: $${computeGroceryCost().toFixed(2)}`);
  return lines.join('\n');
}

function showCopyFeedback(message) {
  const el = document.getElementById('copyFeedback');
  el.textContent = message;
  clearTimeout(showCopyFeedback._timer);
  showCopyFeedback._timer = setTimeout(() => { el.textContent = ''; }, 2000);
}

async function copyGroceryList() {
  const text = buildGroceryListText();
  try {
    await navigator.clipboard.writeText(text);
    showCopyFeedback('Copied!');
  } catch (e) {
    showCopyFeedback('Could not copy');
  }
}

function downloadGroceryList() {
  const text = buildGroceryListText();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'grocery-list.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openRecipeCard(recipeId) {
  const recipe = RECIPES.find(r => r.id === recipeId);
  if (!recipe) return;
  const servings = getServingsFor(recipeId);
  const content = document.getElementById('recipeCardContent');

  const ingHtml = recipe.ingredients
    .map(ing => `<li>${formatIngredientLine(ing.quantity * servings, ing.unit, ing.item)}</li>`)
    .join('');
  const stepsHtml = recipe.instructions.map(step => `<li>${step}</li>`).join('');

  content.innerHTML = `
    <h2>${recipe.name}</h2>
    <div class="recipe-card-meta">
      ${servings} serving${servings > 1 ? 's' : ''} ·
      ${Math.round(recipe.nutrition.proteinG * servings)}g protein ·
      ${Math.round(recipe.nutrition.calories * servings)} cal ·
      ${recipe.cookTimeMinutes} min
    </div>
    <h3>Ingredients</h3>
    <ul class="ingredient-list">${ingHtml}</ul>
    <h3>Instructions</h3>
    <ol class="instruction-list">${stepsHtml}</ol>
  `;
  document.getElementById('recipeCardModal').classList.remove('hidden');
}

function closeRecipeCard() {
  document.getElementById('recipeCardModal').classList.add('hidden');
}

function wireRecipeCardModal() {
  document.getElementById('closeRecipeCardBtn').addEventListener('click', closeRecipeCard);
  document.getElementById('recipeCardModal').addEventListener('click', (e) => {
    if (e.target.id === 'recipeCardModal') closeRecipeCard();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRecipeCard();
  });
  document.getElementById('printRecipeCardBtn').addEventListener('click', () => window.print());
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const STORE_SEARCH_RADII_METERS = [8046, 16093, 24140]; // 5mi, 10mi, 15mi
const MAX_STORE_RESULTS = 8;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeZip(zip) {
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=us&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('geocode-failed');
  const results = await res.json();
  if (!results.length) throw new Error('zip-not-found');
  return { lat: Number(results[0].lat), lon: Number(results[0].lon) };
}

async function queryOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      if (!res.ok) throw new Error('overpass-failed');
      return await res.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('overpass-failed');
}

async function findNearbyStores(lat, lon) {
  for (const radius of STORE_SEARCH_RADII_METERS) {
    const query = `[out:json][timeout:25];(node["shop"~"^(supermarket|grocery)$"](around:${radius},${lat},${lon});way["shop"~"^(supermarket|grocery)$"](around:${radius},${lat},${lon}););out center 30;`;
    const data = await queryOverpass(query);
    const stores = (data.elements || [])
      .map(el => {
        const center = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
        if (!center) return null;
        const tags = el.tags || {};
        return {
          name: tags.name || tags.brand || 'Grocery Store',
          address: formatStoreAddress(tags),
          lat: center.lat,
          lon: center.lon,
          distanceMiles: haversineMiles(lat, lon, center.lat, center.lon)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    if (stores.length >= 3 || radius === STORE_SEARCH_RADII_METERS[STORE_SEARCH_RADII_METERS.length - 1]) {
      return stores.slice(0, MAX_STORE_RESULTS);
    }
  }
  return [];
}

function formatStoreAddress(tags) {
  const streetPart = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const cityPart = [tags['addr:city'], tags['addr:state']].filter(Boolean).join(', ');
  const parts = [streetPart, cityPart, tags['addr:postcode']].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Address unavailable';
}

function renderStoreResults(stores) {
  const container = document.getElementById('storeResultsList');
  container.innerHTML = '';
  stores.forEach(store => {
    const card = document.createElement('div');
    card.className = 'store-result-card';

    const info = document.createElement('div');
    info.className = 'store-result-info';
    const name = document.createElement('div');
    name.className = 'store-result-name';
    name.textContent = store.name;
    const address = document.createElement('div');
    address.className = 'store-result-address';
    address.textContent = store.address;
    info.appendChild(name);
    info.appendChild(address);

    const distance = document.createElement('div');
    distance.className = 'store-result-distance';
    distance.textContent = `${store.distanceMiles.toFixed(1)} mi`;

    const directions = document.createElement('a');
    directions.className = 'store-result-directions';
    directions.href = `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lon}`;
    directions.target = '_blank';
    directions.rel = 'noopener';
    directions.textContent = 'Directions';

    card.appendChild(info);
    card.appendChild(distance);
    card.appendChild(directions);
    container.appendChild(card);
  });
}

function setStoreFinderStatus(text, statusClass) {
  const el = document.getElementById('storeFinderStatus');
  el.textContent = text;
  el.className = 'status-line store-finder-status' + (statusClass ? ` ${statusClass}` : '');
}

async function searchStoresNearZip() {
  const zipInput = document.getElementById('zipInput');
  const zip = zipInput.value.trim();

  if (!/^\d{5}$/.test(zip)) {
    setStoreFinderStatus('Enter a valid 5-digit ZIP code.', 'danger');
    return;
  }

  document.getElementById('storeResultsList').innerHTML = '';
  setStoreFinderStatus('Searching for nearby stores…');

  try {
    const { lat, lon } = await geocodeZip(zip);
    const stores = await findNearbyStores(lat, lon);
    if (!stores.length) {
      setStoreFinderStatus('No grocery stores found near that ZIP code. Try a nearby ZIP.', 'warn');
      return;
    }
    setStoreFinderStatus(`Found ${stores.length} store${stores.length > 1 ? 's' : ''} near ${zip}.`, 'ok');
    renderStoreResults(stores);
  } catch (e) {
    if (e.message === 'zip-not-found') {
      setStoreFinderStatus("Couldn't find that ZIP code. Double-check and try again.", 'danger');
    } else {
      setStoreFinderStatus('Something went wrong looking up stores. Try again in a moment.', 'danger');
    }
  }
}

function openStoreFinder() {
  document.getElementById('storeFinderModal').classList.remove('hidden');
  renderGroceryListInto('storeFinderGroceryList');
}

function closeStoreFinder() {
  document.getElementById('storeFinderModal').classList.add('hidden');
}

function wireStoreFinderModal() {
  document.getElementById('openStoreFinderBtn').addEventListener('click', openStoreFinder);
  document.getElementById('closeStoreFinderBtn').addEventListener('click', closeStoreFinder);
  document.getElementById('storeFinderModal').addEventListener('click', (e) => {
    if (e.target.id === 'storeFinderModal') closeStoreFinder();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStoreFinder();
  });
  document.getElementById('findStoresBtn').addEventListener('click', searchStoresNearZip);
  document.getElementById('zipInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchStoresNearZip();
  });
}

function wireSettings() {
  const targetSelect = document.getElementById('targetProtein');
  targetSelect.innerHTML = '';
  for (let v = PROTEIN_MIN; v <= PROTEIN_MAX; v += PROTEIN_STEP) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = String(v);
    targetSelect.appendChild(opt);
  }
  targetSelect.value = String(state.settings.targetProtein);

  targetSelect.addEventListener('change', () => {
    state.settings.targetProtein = Number(targetSelect.value);
    persistSettings();
    renderGoalReadout();
    renderPlanPanel();
  });
}

function wireBudget() {
  const slider = document.getElementById('budgetSlider');
  slider.min = String(BUDGET_MIN);
  slider.max = String(BUDGET_MAX);
  slider.step = String(BUDGET_STEP);
  slider.value = String(state.settings.budgetTarget);

  slider.addEventListener('input', () => {
    state.settings.budgetTarget = Number(slider.value);
    persistSettings();
    renderBudgetSection();
  });

  document.querySelectorAll('.budget-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.settings.budgetMode);
    btn.addEventListener('click', () => {
      state.settings.budgetMode = btn.dataset.mode;
      persistSettings();
      document.querySelectorAll('.budget-mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === state.settings.budgetMode));
      renderBudgetSection();
    });
  });
}

function wireControls() {
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderRecipeGrid();
  });
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderRecipeGrid();
  });
  document.getElementById('clearPlanBtn').addEventListener('click', clearPlan);
  document.getElementById('favoritesOnlyBtn').addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    document.getElementById('favoritesOnlyBtn').classList.toggle('active', state.favoritesOnly);
    renderRecipeGrid();
  });
  document.getElementById('uncheckAllBtn').addEventListener('click', () => {
    state.groceryChecked = {};
    persistGroceryChecked();
    renderGroceryList();
  });
  document.getElementById('copyGroceryBtn').addEventListener('click', copyGroceryList);
  document.getElementById('downloadGroceryBtn').addEventListener('click', downloadGroceryList);
}

async function init() {
  loadPersisted();
  wireSettings();
  wireBudget();
  wireControls();
  wireRecipeCardModal();
  wireStoreFinderModal();
  renderChips();
  renderGoalReadout();

  const res = await fetch('data/recipes.json', { cache: 'no-store' });
  const data = await res.json();
  RECIPES = data.recipes;

  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
  renderBudgetSection();
}

init();
