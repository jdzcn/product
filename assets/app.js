(() => {
  "use strict";

  const state = { q: "", style: null, craft: null, theme: null, sort: "default" };
  const detail = document.getElementById("detail");
  const grid = document.getElementById("grid");
  const searchInput = document.getElementById("q");
  const clearButton = document.getElementById("clear");
  const empty = document.getElementById("empty");
  const resultLine = document.getElementById("result-line");

  let data = null;
  let rafId = 0;

  const priceText = (value) =>
    value > 0 ? "¥ " + value.toLocaleString("zh-CN") : "询价";

  const imageUrl = (base, file) => `${base}/${encodeURIComponent(file)}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- filters ---------- */

  function makeChip(label, count, kind, value) {
    const chip = el("button", "chip");
    chip.type = "button";
    chip.dataset.kind = kind;
    chip.dataset.value = value === null ? "" : String(value);
    chip.append(el("span", "", label), el("small", "", String(count)));
    chip.addEventListener("click", () => {
      if (value === null) state[kind] = null;
      else state[kind] = state[kind] === value ? null : value;
      syncChips();
      render();
    });
    return chip;
  }

  function filterGroup(label, items, kind) {
    const group = el("div", "filter-group");
    const chips = el("div", "chips");
    const total = items.reduce((sum, item) => sum + item.count, 0);
    chips.append(makeChip("全部", total, kind, null));
    items.forEach((item) =>
      chips.append(makeChip(item.name, item.count, kind, item.id))
    );
    group.append(el("span", "filter-label", label), chips);
    return group;
  }

  function renderFilters() {
    const filters = document.getElementById("filters");
    filters.replaceChildren(
      filterGroup(
        "器型",
        data.styles.map((s) => ({ id: s.sid, name: s.name, count: s.count })),
        "style"
      ),
      filterGroup(
        "工艺",
        data.crafts.map((c) => ({ id: c.cid, name: c.name, count: c.count })),
        "craft"
      ),
      filterGroup(
        "题材",
        data.themes.map((t) => ({ id: t.gid, name: t.name, count: t.count })),
        "theme"
      )
    );
    syncChips();
  }

  function syncChips() {
    document.querySelectorAll(".chip").forEach((chip) => {
      const kind = chip.dataset.kind;
      const value = chip.dataset.value === "" ? null : Number(chip.dataset.value);
      const active =
        value === null ? state[kind] === null : state[kind] === value;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  }

  /* ---------- catalogue ---------- */

  function filteredProducts() {
    const query = state.q.toLowerCase();
    return data.products.filter((p) => {
      if (state.style !== null && p.sid !== state.style) return false;
      if (state.craft !== null && p.cid !== state.craft) return false;
      if (state.theme !== null && p.gid !== state.theme) return false;
      if (!query) return true;
      const haystack = [p.name, p.style, p.craft, p.theme, p.spec]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  function priceRank(product) {
    return product.price > 0 ? product.price : null;
  }

  function sortProducts(list) {
    const sorted = list.slice();
    if (state.sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    } else if (state.sort === "price-asc" || state.sort === "price-desc") {
      const direction = state.sort === "price-asc" ? 1 : -1;
      sorted.sort((a, b) => {
        const pa = priceRank(a);
        const pb = priceRank(b);
        if (pa === null && pb === null) return a.pid - b.pid;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return (pa - pb) * direction || a.pid - b.pid;
      });
    } else {
      sorted.sort((a, b) => a.pid - b.pid);
    }
    return sorted;
  }

  function card(product, index) {
    const node = el("button", "card");
    node.type = "button";
    node.setAttribute(
      "aria-label",
      `${product.name}，${product.style}，${priceText(product.price)}`
    );

    const media = el("span", "card-media");
    const img = new Image();
    img.src = imageUrl("thumb", product.image);
    img.alt = product.name;
    img.width = 300;
    img.height = 300;
    img.decoding = "async";
    img.loading = index < 8 ? "eager" : "lazy";
    media.append(img);

    const body = el("span", "card-body");
    const meta = [product.style, product.theme].filter(Boolean).join(" · ");
    const foot = el("span", "card-foot");
    const price = el(
      "span",
      product.price > 0 ? "price" : "price is-ask",
      priceText(product.price)
    );
    foot.append(price, el("span", "card-craft", product.craft));
    body.append(
      el("span", "card-title", product.name),
      el("span", "card-meta", meta),
      foot
    );

    node.append(media, body);
    node.addEventListener("click", () => openDetail(product));
    return node;
  }

  function render() {
    if (!data) return;
    const list = sortProducts(filteredProducts());
    const fragment = document.createDocumentFragment();
    list.forEach((product, index) => fragment.append(card(product, index)));
    grid.replaceChildren(fragment);
    grid.setAttribute("aria-busy", "false");

    const active = state.q || state.style !== null || state.craft !== null || state.theme !== null;
    resultLine.textContent = active
      ? `筛选出 ${list.length} 件 / 共 ${data.meta.productCount} 件器物`
      : `共 ${data.meta.productCount} 件器物`;
    empty.hidden = list.length !== 0;
  }

  /* ---------- detail ---------- */

  function addSpec(term, value) {
    const specs = document.getElementById("detail-specs");
    specs.append(el("dt", "", term), el("dd", "", value));
  }

  function addNote(title, body) {
    const note = el("div", "detail-note");
    note.append(el("h3", "", title), el("p", "", body));
    document.getElementById("detail-notes").append(note);
  }

  function updateUrl(pid) {
    const url = new URL(location.href);
    if (pid) url.searchParams.set("id", String(pid));
    else url.searchParams.delete("id");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function openDetail(product) {
    const img = document.getElementById("detail-img");
    img.src = imageUrl("images", product.image);
    img.alt = product.name;

    document.getElementById("detail-kicker").textContent = [
      product.craft,
      product.style,
      product.theme,
    ]
      .filter(Boolean)
      .join(" · ");
    document.getElementById("detail-title").textContent = product.name;

    const price = document.getElementById("detail-price");
    price.textContent = priceText(product.price);
    price.classList.toggle("is-ask", product.price <= 0);

    const specs = document.getElementById("detail-specs");
    specs.replaceChildren();
    addSpec("器型", product.style);
    addSpec("工艺", product.craft);
    addSpec("题材", product.theme);
    if (product.spec) addSpec("规格", product.spec);
    addSpec("编号", `#${product.pid}`);

    const notes = document.getElementById("detail-notes");
    notes.replaceChildren();
    const theme = data.themes.find((t) => t.gid === product.gid);
    if (theme && theme.description) addNote("题材寓意", theme.description);
    const craft = data.crafts.find((c) => c.cid === product.cid);
    if (craft && craft.description) addNote("工艺说明", craft.description);

    detail.showModal();
    document.body.classList.add("no-scroll");
    updateUrl(product.pid);
    detail.querySelector(".detail-close").focus();
  }

  function closeDetail() {
    if (detail.open) detail.close();
  }

  /* ---------- notes ---------- */

  function renderNotes() {
    const craftNotes = document.getElementById("craft-notes");
    craftNotes.replaceChildren();
    data.crafts.forEach((craft) => {
      const cardNode = el("div", "note-card");
      const heading = el("h3", "", craft.name);
      heading.append(el("small", "", `${craft.count} 件`));
      cardNode.append(
        heading,
        el("p", "", craft.description || "暂无说明。")
      );
      craftNotes.append(cardNode);
    });

    const themeNotes = document.getElementById("theme-notes");
    themeNotes.replaceChildren();
    data.themes.forEach((theme) => {
      const item = el("details", "theme");
      const summary = el("summary");
      const label = el("span", "", theme.name);
      label.append(el("small", "", `${theme.count} 件`));
      summary.append(label);
      item.append(
        summary,
        el("p", "", theme.description || "暂无说明。")
      );
      themeNotes.append(item);
    });
  }

  /* ---------- boot ---------- */

  function renderMeta() {
    const stats = [
      `${data.meta.productCount} 件器物`,
      `${data.styles.length} 种器型`,
      `${data.themes.filter((t) => !t.missing).length} 类题材`,
      `${data.crafts.length} 种工艺`,
    ];
    document.getElementById("hero-stats").textContent = stats.join(" · ");
    document.getElementById("footer-meta").textContent =
      `静态导出 · ${data.meta.productCount} 件器物 / ${data.meta.imageCount} 张图片`;
  }

  function bind() {
    searchInput.addEventListener("input", () => {
      state.q = searchInput.value.trim();
      clearButton.hidden = searchInput.value.length === 0;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(render);
    });

    clearButton.addEventListener("click", () => {
      searchInput.value = "";
      state.q = "";
      clearButton.hidden = true;
      searchInput.focus();
      render();
    });

    document.getElementById("sort").addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });

    document.getElementById("reset").addEventListener("click", () => {
      state.q = "";
      state.style = null;
      state.craft = null;
      state.theme = null;
      state.sort = "default";
      searchInput.value = "";
      clearButton.hidden = true;
      document.getElementById("sort").value = "default";
      syncChips();
      render();
      searchInput.focus();
    });

    detail.querySelector(".detail-close").addEventListener("click", closeDetail);

    detail.addEventListener("click", (event) => {
      if (event.target !== detail) return;
      const rect = detail.getBoundingClientRect();
      const outside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (outside) closeDetail();
    });

    detail.addEventListener("close", () => {
      document.body.classList.remove("no-scroll");
      updateUrl(null);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !detail.open && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput.focus();
      }
    });
  }

  async function boot() {
    try {
      const response = await fetch("data.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();

      renderMeta();
      renderFilters();
      renderNotes();
      bind();
      render();

      const pid = Number(new URLSearchParams(location.search).get("id"));
      if (Number.isInteger(pid) && pid > 0) {
        const product = data.products.find((p) => p.pid === pid);
        if (product) openDetail(product);
      }
    } catch (error) {
      grid.setAttribute("aria-busy", "false");
      grid.replaceChildren(
        el("p", "empty", `数据加载失败：${error.message}`)
      );
    }
  }

  boot();
})();
