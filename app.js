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

const STORAGE_PLAN = 'proteinApp.plan';
const STORAGE_SETTINGS = 'proteinApp.settings';
const STORAGE_GROCERY_CHECKED = 'proteinApp.groceryChecked';

let RECIPES = [];

const state = {
  search: '',
  mealType: 'all',
  devices: new Set(),
  sort: 'protein-desc',
  servingsChoice: {},   // recipeId -> pending servings (1-5) before/while in plan
  plan: {},             // recipeId -> servings
  settings: { targetProtein: 185, consumedProtein: 56 },
  groceryChecked: {}    // itemKey -> boolean
};

function loadPersisted() {
  try {
    const plan = JSON.parse(localStorage.getItem(STORAGE_PLAN));
    if (plan && typeof plan === 'object') state.plan = plan;
  } catch (e) {}
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_SETTINGS));
    if (settings && typeof settings === 'object') {
      state.settings.targetProtein = Number(settings.targetProtein) || 185;
      state.settings.consumedProtein = Number(settings.consumedProtein) || 56;
    }
  } catch (e) {}
  try {
    const checked = JSON.parse(localStorage.getItem(STORAGE_GROCERY_CHECKED));
    if (checked && typeof checked === 'object') state.groceryChecked = checked;
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
}

function removeFromPlan(recipeId) {
  delete state.plan[recipeId];
  persistPlan();
  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
}

function clearPlan() {
  state.plan = {};
  persistPlan();
  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
}

function matchesFilters(recipe) {
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

  const title = document.createElement('h3');
  title.textContent = recipe.name;

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

  card.appendChild(tagRow);
  card.appendChild(title);
  card.appendChild(macroRow);
  card.appendChild(cardControls);
  card.appendChild(details);

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
  const target = state.settings.targetProtein;
  const consumed = state.settings.consumedProtein;
  return Math.max(0, target - consumed);
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
    `Need ${goal}g protein from meals/snacks today`;
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
  const map = {}; // key -> { category, item, unit, qty }
  Object.entries(state.plan).forEach(([id, servings]) => {
    const recipe = RECIPES.find(r => r.id === id);
    if (!recipe) return;
    recipe.ingredients.forEach(ing => {
      const key = `${ing.category}|${ing.item.trim().toLowerCase()}|${ing.unit.trim().toLowerCase()}`;
      const scaledQty = ing.quantity * servings;
      if (map[key]) {
        map[key].qty += scaledQty;
      } else {
        map[key] = { key, category: ing.category, item: ing.item, unit: ing.unit, qty: scaledQty };
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

function renderGroceryList() {
  const container = document.getElementById('groceryList');
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
        label.classList.toggle('checked', checkbox.checked);
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

function wireSettings() {
  const targetInput = document.getElementById('targetProtein');
  const consumedInput = document.getElementById('consumedProtein');
  targetInput.value = state.settings.targetProtein;
  consumedInput.value = state.settings.consumedProtein;

  targetInput.addEventListener('input', () => {
    state.settings.targetProtein = Number(targetInput.value) || 0;
    persistSettings();
    renderGoalReadout();
    renderPlanPanel();
  });
  consumedInput.addEventListener('input', () => {
    state.settings.consumedProtein = Number(consumedInput.value) || 0;
    persistSettings();
    renderGoalReadout();
    renderPlanPanel();
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
  document.getElementById('uncheckAllBtn').addEventListener('click', () => {
    state.groceryChecked = {};
    persistGroceryChecked();
    renderGroceryList();
  });
}

async function init() {
  loadPersisted();
  wireSettings();
  wireControls();
  renderChips();
  renderGoalReadout();

  const res = await fetch('data/recipes.json');
  const data = await res.json();
  RECIPES = data.recipes;

  renderRecipeGrid();
  renderPlanPanel();
  renderGroceryList();
}

init();
