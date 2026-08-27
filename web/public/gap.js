/* gap.html 정렬·검색 — 순수 JS, 의존성 0.
   서버 CSP 가 script-src 'self' 라 인라인 <script> 는 실행되지 않는다 → 외부 파일.
   scripts/build_gap.py 가 함께 배치한다(수정은 그 스크립트에서). */
(function () {
  var t = document.getElementById('gap');
  if (!t || !t.tHead || !t.tBodies.length) return;
  var body = t.tBodies[0];
  var rows = [].slice.call(body.rows);
  var heads = [].slice.call(t.tHead.rows[0].cells);
  var cur = 1, dir = 1; // 초기 상태 = 장애인 가맹 asc (HTML 이 이미 그 순서로 나온다)
  function val(tr, i) {
    var raw = tr.cells[i].getAttribute('data-v');
    var n = Number(raw);
    return raw !== null && raw !== '' && !isNaN(n) ? n : String(raw === null ? '' : raw);
  }
  function sort(i) {
    dir = i === cur ? -dir : 1;
    cur = i;
    heads.forEach(function (h, j) {
      h.setAttribute('aria-sort', j === i ? (dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    rows.slice().sort(function (a, b) {
      var x = val(a, i), y = val(b, i);
      var c = x < y ? -1 : x > y ? 1 : 0;
      return c ? c * dir : Number(a.dataset.i) - Number(b.dataset.i);
    }).forEach(function (tr) { body.appendChild(tr); });
  }
  heads.forEach(function (h, i) {
    h.tabIndex = 0;
    h.addEventListener('click', function () { sort(i); });
    h.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(i); }
    });
  });
  var q = document.getElementById('q');
  var shown = document.getElementById('shown');
  var none = document.getElementById('none');
  function filter() {
    var s = q.value.replace(/\s+/g, ''), n = 0;
    rows.forEach(function (tr) {
      var hit = !s || tr.dataset.q.indexOf(s) >= 0;
      tr.hidden = !hit;
      if (hit) n++;
    });
    shown.textContent = n.toLocaleString('ko-KR');
    none.hidden = n > 0;
  }
  q.addEventListener('input', filter);
  filter();
})();
