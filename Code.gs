/**
 * Quiz Lab — Google Apps Script + Google Sheets backend.
 * Run setupQuizLab() once from the Apps Script editor before deploying.
 * Anyone can create and assign quizzes. Each browser owns its content with a private random token;
 * learners join by code and results are visible only to the creator token for that assignment.
 */
function doGet(e) {
  // Read the join code on the server before Apps Script redirects/renders the page.
  // This is more reliable than depending only on window.location.search in the browser.
  var rawJoin = e && e.parameter ? String(e.parameter.join || '') : '';
  var digits = rawJoin.replace(/\D/g, '');
  var joinCodeFromUrl = /^\d{8}$/.test(digits) ? digits : '';

  var template = HtmlService.createTemplateFromFile('Index');
  template.joinCodeFromUrl = joinCodeFromUrl;
  template.exportOwnerKey = (e && e.parameter && String(e.parameter.exportOwnerKey) === '1') ? '1' : '';
  return template.evaluate()
    .setTitle('Quiz Lab')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * JSON API for the standalone website hosted on Netlify.
 * The public endpoint exposes only the explicitly approved Quiz Lab API methods below.
 * Each underlying method still performs its own owner-key / assignment validation.
 */
function doPost(e) {
  var output;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var request = JSON.parse(raw);
    var name = String(request && request.name || '');
    var args = Array.isArray(request && request.args) ? request.args : [];
    var api = {
      quizLabApiGetWebAppUrl: quizLabApiGetWebAppUrl,
      quizLabApiIsTeacher: quizLabApiIsTeacher,
      quizLabApiMigrateLegacy: quizLabApiMigrateLegacy,
      quizLabApiMigrateOwner: quizLabApiMigrateOwner,
      quizLabApiList: quizLabApiList,
      quizLabApiGetJoinAssignment: quizLabApiGetJoinAssignment,
      quizLabApiGet: quizLabApiGet,
      quizLabApiGetQuizForAssignment: quizLabApiGetQuizForAssignment,
      quizLabApiSaveQuiz: quizLabApiSaveQuiz,
      quizLabApiSet: quizLabApiSet,
      quizLabApiDelete: quizLabApiDelete,
      quizLabApiAdd: quizLabApiAdd,
      quizLabApiQuestions: quizLabApiQuestions,
      quizLabApiPlayersForCode: quizLabApiPlayersForCode,
      quizLabApiCountAttempts: quizLabApiCountAttempts
    };
    if (!Object.prototype.hasOwnProperty.call(api, name)) {
      throw new Error('API không được phép gọi.');
    }
    if (args.length > 5) throw new Error('Số tham số không hợp lệ.');
    var value = api[name].apply(null, args);
    output = {ok: true, value: value === undefined ? null : value};
  } catch (err) {
    output = {ok: false, error: String(err && err.message ? err.message : err)};
  }
  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Return the deployed web-app URL used in join links; never share the Apps Script editor preview URL. */
function quizLabApiGetWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
    throw new Error('Chưa tìm thấy URL triển khai /exec. Hãy Deploy → Manage deployments và mở bản Web app đã triển khai.');
  }
  return url;
}

/** One-time setup. Run manually once for a new deployment; no teacher key is required for normal use. */
function setupQuizLab() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('QUIZLAB_SPREADSHEET_ID');
  var ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.create('Quiz Lab — Dữ liệu lớp học');
    spreadsheetId = ss.getId();
    props.setProperty('QUIZLAB_SPREADSHEET_ID', spreadsheetId);
  }

  var definitions = [
    ['Quizzes', 'ID, Relation, Label, UpdatedAt, JSON1, JSON2, JSON3, JSON4, JSON5, JSON6'],
    ['Questions', 'ID, QuizID, Order, UpdatedAt, JSON1, JSON2, JSON3, JSON4, JSON5, JSON6'],
    ['Assignments', 'Code, QuizID, Title, CreatedAt, JSON1, JSON2, JSON3, JSON4, JSON5, JSON6'],
    ['Players', 'ID, AssignmentCode, DisplayName, LastSeen, JSON1, JSON2, JSON3, JSON4, JSON5, JSON6'],
    ['Attempts', 'ID, AssignmentCode, DisplayName, SubmittedAt, JSON1, JSON2, JSON3, JSON4, JSON5, JSON6']
  ];
  definitions.forEach(function (def) {
    var sh = ss.getSheetByName(def[0]);
    if (!sh) {
      if (def[0] === 'Quizzes' && ss.getSheets().length === 1 && ss.getSheets()[0].getName() === 'Sheet1' && ss.getSheets()[0].getLastRow() === 0) {
        sh = ss.getSheets()[0]; sh.setName(def[0]);
      } else {
        sh = ss.insertSheet(def[0]);
      }
    }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, 10).setValues([def[1].split(', ')]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, 10).setFontWeight('bold');
    }
  });

  Logger.log('Quiz Lab backend đã sẵn sàng. Google Sheet: ' + ss.getUrl());
  return 'Thiết lập Quiz Lab hoàn tất. Không cần mã giáo viên để tạo và chia sẻ bài.';
}

/** Legacy global key is kept only to migrate old single-teacher data. */
function quizLabApiIsTeacher(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('QUIZLAB_TEACHER_KEY');
  return !!expected && String(key || '') === expected;
}

/** Transfer old records from the former single-teacher model to this browser's private owner token. */
function quizLabApiMigrateLegacy(oldKey, newOwnerKey) {
  if (!quizLabApiIsTeacher(oldKey)) throw new Error('Mã giáo viên cũ không hợp lệ; không thể chuyển dữ liệu cũ.');
  if (!_validOwnerKey_(newOwnerKey)) throw new Error('Mã quản lý cá nhân không hợp lệ.');
  var migrated = 0;
  ['Quizzes', 'Assignments'].forEach(function (table) {
    _rows_(table).forEach(function (row) {
      if (!row.data.ownerKey) {
        var data = Object.assign({}, row.data, {ownerKey: String(newOwnerKey)});
        _upsert_(table, row.id, row.relation, row.label, row.updatedAt || Date.now(), data);
        migrated++;
      }
    });
  });
  return migrated;
}

/** Transfer records from the owner token used on the old Apps Script origin to the new website token. */
function quizLabApiMigrateOwner(oldOwnerKey, newOwnerKey) {
  var oldKey = String(oldOwnerKey || '').trim();
  var newKey = String(newOwnerKey || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(oldKey) || !/^[a-f0-9]{64}$/i.test(newKey)) {
    throw new Error('Mã quản lý cũ hoặc mới không hợp lệ. Hãy sao chép đủ 64 ký tự.');
  }
  if (oldKey === newKey) return 0;
  var migrated = 0;
  ['Quizzes', 'Assignments'].forEach(function (table) {
    _rows_(table).forEach(function (row) {
      if (String((row.data || {}).ownerKey || '') === oldKey) {
        var data = Object.assign({}, row.data, {ownerKey: newKey});
        _upsert_(table, row.id, row.relation, row.label, row.updatedAt || Date.now(), data);
        migrated++;
      }
    });
  });
  return migrated;
}

function quizLabApiList(path, key) {
  var p = String(path || '').split('/').filter(Boolean);
  var valid = _validOwnerKey_(key);
  if (p.length === 3 && p[0] === 'quizzes' && p[2] === 'q') {
    var quizId = p[1];
    if (!_canManageQuiz_(quizId, key)) return [];
    return _rows_('Questions').filter(function (r) { return r.relation === quizId; })
      .map(function (r) { return Object.assign({}, r.data, {id: r.id, order: Number(r.data.order != null ? r.data.order : r.label) || 0}); })
      .sort(function (a, b) { return a.order - b.order; });
  }
  if (p.length !== 1) throw new Error('Đường dẫn dữ liệu không hợp lệ.');
  if (p[0] === 'quizzes') {
    if (!valid) return [];
    return _rows_('Quizzes').filter(function (r) { return _canManageData_(r.data, key); })
      .map(function (r) { return Object.assign({}, _publicData_(r.data), {id: r.id}); });
  }
  if (p[0] === 'assignments') {
    if (!valid) return [];
    return _rows_('Assignments').filter(function (r) { return _canManageData_(r.data, key); })
      .map(function (r) { return Object.assign({}, _publicData_(r.data), {id: r.id}); });
  }
  if (p[0] === 'attempts') {
    if (!valid) return [];
    var ownedCodes = {};
    _rows_('Assignments').forEach(function (r) { if (_canManageData_(r.data, key)) ownedCodes[r.id] = true; });
    return _rows_('Attempts').filter(function (r) { return !!ownedCodes[String(r.data.aid || r.relation)]; })
      .map(function (r) { return Object.assign({}, _publicData_(r.data), {id: r.id}); });
  }
  if (p[0] === 'players') {
    if (!valid) return [];
    var ownedPlayerCodes = {};
    _rows_('Assignments').forEach(function (r) { if (_canManageData_(r.data, key)) ownedPlayerCodes[r.id] = true; });
    return _rows_('Players').filter(function (r) { return !!ownedPlayerCodes[String(r.data.aid || r.relation)]; })
      .map(function (r) { return Object.assign({}, _publicData_(r.data), {id: r.id}); });
  }
  throw new Error('Không hỗ trợ danh sách dữ liệu này.');
}

/** Public, read-only resolver for an 8-digit join code. Returns only learner-safe fields. */
function quizLabApiGetJoinAssignment(code) {
  code = String(code || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(code)) return null;
  var row = _find_('Assignments', code);
  if (!row) {
    // Recover assignments from earlier schema variants where the code was saved inside JSON.
    var rows = _rows_('Assignments');
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].data || {};
      if (String(d.id || '') === code || String(d.code || '') === code) { row = rows[i]; break; }
    }
  }
  if (!row) return null;
  var safe = _publicAssignment_(row.data);
  safe.id = code;
  return safe;
}

function quizLabApiGet(path, key) {
  var p = String(path || '').split('/').filter(Boolean);
  if (p.length !== 2) return null;
  var table = p[0] === 'quizzes' ? 'Quizzes' : p[0] === 'assignments' ? 'Assignments' : null;
  if (!table) return null;
  var row = _find_(table, p[1]);
  if (!row) return null;
  if (_canManageData_(row.data, key)) return Object.assign({}, _publicData_(row.data), {id: row.id});
  // Public learners may look up a single assignment using its exact 8-digit code.
  if (table === 'Assignments' && /^\d{8}$/.test(p[1])) return Object.assign({}, _publicAssignment_(row.data), {id: row.id});
  // A quiz's metadata is exposed only when it is linked to an existing assignment.
  if (table === 'Quizzes' && _quizHasAssignment_(p[1])) return Object.assign({}, _publicData_(row.data), {id: row.id});
  return null;
}

function quizLabApiGetQuizForAssignment(quizId, assignmentCode) {
  var aid = String(assignmentCode || '');
  var assignment = _find_('Assignments', aid);
  if (!assignment || String(assignment.data.quizId || assignment.relation) !== String(quizId || '')) {
    throw new Error('Mã tham gia không khớp với đề.');
  }
  var quiz = _find_('Quizzes', String(quizId || ''));
  if (!quiz) throw new Error('Không tìm thấy đề của bài tập.');
  return Object.assign({}, _publicData_(quiz.data), {id: quiz.id});
}

/** Save quiz metadata and all its questions in one server call and one short lock. */
function quizLabApiSaveQuiz(quiz, key) {
  if (!_validOwnerKey_(key)) throw new Error('Không tìm thấy mã quản lý cá nhân của người tạo bài. Hãy tải lại trang.');
  if (!quiz || typeof quiz !== 'object') throw new Error('Dữ liệu đề không hợp lệ.');
  var quizId = String(quiz.id || '');
  if (!quizId) throw new Error('Đề chưa có ID.');
  var questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  if (!questions.length) throw new Error('Đề chưa có câu hỏi.');
  var existingQuiz = _find_('Quizzes', quizId);
  if (existingQuiz && !_canManageData_(existingQuiz.data, key)) throw new Error('Bạn không có quyền sửa đề này.');

  var meta = Object.assign({}, quiz, {id: quizId, ownerKey: String(key), n: questions.length});
  delete meta.questions;
  var items = [{table:'Quizzes', id:quizId, relation:'', label:meta.title || '', updatedAt:Date.now(), data:meta}];

  // Preserve legacy row IDs for questions already belonging to this quiz. For
  // copied questions, scope the storage ID by quiz to avoid cross-quiz conflicts.
  var rows = _rows_('Questions'), byId = {}, bySource = {};
  rows.forEach(function (r) {
    byId[r.id] = r;
    if (r.relation === quizId) {
      bySource[r.id] = r.id;
      if (r.data && r.data.sourceId) bySource[String(r.data.sourceId)] = r.id;
    }
  });
  var seenLocal = {};
  questions.forEach(function (q, i) {
    var localId = String(q && q.id || ('q' + (i + 1)));
    if (seenLocal[localId]) localId = localId + '__' + (i + 1);
    seenLocal[localId] = true;
    var storageId = bySource[localId] || (quizId + '__' + localId);
    var suffix = 2;
    while (byId[storageId] && byId[storageId].relation !== quizId) {
      storageId = quizId + '__' + localId + '__' + suffix++;
    }
    var qData = Object.assign({}, q, {id:storageId, sourceId:localId, quizId:quizId, order:i});
    items.push({table:'Questions', id:storageId, relation:quizId, label:String(i), updatedAt:Date.now(), data:qData});
  });
  _upsertMany_(items);
  return true;
}

function quizLabApiSet(path, data, key) {
  var p = String(path || '').split('/').filter(Boolean);
  if (!p.length || !data || typeof data !== 'object') throw new Error('Dữ liệu lưu không hợp lệ.');
  if (!_validOwnerKey_(key)) throw new Error('Không tìm thấy mã quản lý cá nhân của người tạo bài. Hãy tải lại trang.');
  if (p[0] === 'quizzes' && p.length === 2) {
    var qid = p[1], existingQuiz = _find_('Quizzes', qid);
    if (existingQuiz && !_canManageData_(existingQuiz.data, key)) throw new Error('Bạn không có quyền sửa đề này.');
    var meta = Object.assign({}, data, {id: qid, ownerKey: String(key)});
    delete meta.questions;
    _upsert_('Quizzes', qid, '', meta.title || '', Date.now(), meta);
    return true;
  }
  if (p[0] === 'quizzes' && p.length === 4 && p[2] === 'q') {
    var quizId = p[1], questionId = p[3];
    if (!_canManageQuiz_(quizId, key)) throw new Error('Bạn không có quyền sửa câu hỏi của đề này.');

    // Question IDs are generated in the browser and can be copied with a question
    // into another quiz. The old schema used that ID as a global sheet key, which
    // caused "Câu hỏi này thuộc một đề khác". Reuse a row already belonging to
    // this quiz; otherwise namespace the storage ID by quiz. This keeps writes
    // idempotent and lets legacy rows continue working.
    var questionRows = _rows_('Questions');
    var sameQuizQuestion = null;
    for (var qi = 0; qi < questionRows.length; qi++) {
      var qr = questionRows[qi];
      if (qr.relation === quizId && (qr.id === questionId || String(qr.data.sourceId || '') === questionId)) {
        sameQuizQuestion = qr;
        break;
      }
    }

    var storageQuestionId;
    if (sameQuizQuestion) {
      storageQuestionId = sameQuizQuestion.id;
    } else {
      storageQuestionId = quizId + '__' + questionId;
      // Guard against rare collisions with historic or malformed IDs.
      var suffix = 2;
      var occupied = _find_('Questions', storageQuestionId);
      while (occupied && occupied.relation !== quizId) {
        storageQuestionId = quizId + '__' + questionId + '__' + suffix++;
        occupied = _find_('Questions', storageQuestionId);
      }
      if (occupied && occupied.relation === quizId) storageQuestionId = occupied.id;
    }

    var question = Object.assign({}, data, {
      id: storageQuestionId,
      sourceId: questionId,
      quizId: quizId
    });
    _upsert_('Questions', storageQuestionId, quizId, String(question.order || 0), Date.now(), question);
    return true;
  }
  if (p[0] === 'assignments' && p.length === 2) {
    if (!/^\d{8}$/.test(p[1])) throw new Error('Mã tham gia phải gồm 8 chữ số.');
    var existingAssignment = _find_('Assignments', p[1]);
    if (existingAssignment && !_canManageData_(existingAssignment.data, key)) throw new Error('Mã bài đã tồn tại hoặc bạn không có quyền quản lý bài này.');
    var assignment = Object.assign({}, data, {id: p[1], ownerKey: String(key)});
    var quizRow = _find_('Quizzes', String(assignment.quizId || ''));
    if (!quizRow) throw new Error('Không tìm thấy đề gốc của bài tập.');
    if (!_canManageData_(quizRow.data, key)) throw new Error('Bạn chỉ có thể giao đề do chính mình tạo.');
    _upsert_('Assignments', p[1], assignment.quizId, assignment.title || '', assignment.created || Date.now(), assignment);
    return true;
  }
  if (p[0] === 'players' && p.length === 2) {
    var aid = String(data.aid || '');
    if (!_find_('Assignments', aid)) throw new Error('Mã bài tập không tồn tại.');
    var playerName = _cleanName_(data.name);
    if (p[1] !== aid + '_' + _slug_(playerName)) throw new Error('Mã người tham gia không hợp lệ.');
    var player = Object.assign({}, data, {id: p[1], aid: aid, name: playerName});
    _upsert_('Players', p[1], aid, player.name, Date.now(), player);
    return true;
  }
  throw new Error('Không được phép ghi dữ liệu tại đường dẫn này.');
}

function quizLabApiDelete(path, key) {
  var p = String(path || '').split('/').filter(Boolean);
  if (!p.length) throw new Error('Đường dẫn xóa không hợp lệ.');
  if (p[0] === 'quizzes' && p.length === 4 && p[2] === 'q') {
    if (!_canManageQuiz_(p[1], key)) throw new Error('Bạn không có quyền xóa câu hỏi của đề này.');
    var qrow = _find_('Questions', p[3]);
    if (!qrow || qrow.relation !== p[1]) return false;
    return _delete_('Questions', p[3]);
  }
  if (p.length !== 2) throw new Error('Đường dẫn xóa không hợp lệ.');
  var table = {quizzes: 'Quizzes', assignments: 'Assignments', attempts: 'Attempts', players: 'Players'}[p[0]];
  if (!table) throw new Error('Không được phép xóa dữ liệu tại đường dẫn này.');
  var row = _find_(table, p[1]);
  if (!row) return false;
  if (table === 'Quizzes') {
    if (!_canManageData_(row.data, key)) throw new Error('Bạn không có quyền xóa đề này.');
  } else if (table === 'Assignments') {
    if (!_canManageData_(row.data, key)) throw new Error('Bạn không có quyền xóa bài giao này.');
  } else if (table === 'Attempts' || table === 'Players') {
    var aid2 = String(row.data.aid || row.relation || '');
    if (!_ownsAssignment_(aid2, key)) throw new Error('Bạn không có quyền quản lý dữ liệu của bài này.');
  }
  return _delete_(table, p[1]);
}

function quizLabApiAdd(collection, data, key) {
  if (String(collection) !== 'attempts') throw new Error('Chỉ hỗ trợ nộp kết quả qua API thêm dữ liệu.');
  var aid = String(data && data.aid || '');
  var assignmentRow = _find_('Assignments', aid);
  if (!assignmentRow) throw new Error('Không tìm thấy bài tập. Hãy kiểm tra mã tham gia.');
  var assignment = assignmentRow.data;
  var now = Date.now();
  if (assignment.start && now < Number(assignment.start)) throw new Error('Bài tập chưa mở.');
  if (assignment.end && now > Number(assignment.end) && !assignment.late) throw new Error('Bài tập đã đóng và không nhận bài muộn.');
  if (String(data.quizId || '') !== String(assignment.quizId || assignmentRow.relation)) throw new Error('Đề không khớp với mã bài tập.');
  var name = _cleanName_(data.name);
  if (!name) throw new Error('Thiếu tên hiển thị.');
  var attemptsLimit = Math.max(0, Number(assignment.attempts) || 0);
  var sameNameAttempts = _rows_('Attempts').filter(function (r) {
    return r.relation === aid && String(r.label || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase();
  }).length;
  if (attemptsLimit && sameNameAttempts >= attemptsLimit) throw new Error('Bạn đã dùng hết số lượt làm bài được phép.');

  var questions = _rows_('Questions').filter(function (r) { return r.relation === String(assignment.quizId || assignmentRow.relation); })
    .map(function (r) { return Object.assign({}, r.data, {id: r.id, order: Number(r.data.order != null ? r.data.order : r.label) || 0}); })
    .sort(function (a, b) { return a.order - b.order; });
  var responseList = Array.isArray(data.responses) ? data.responses : [];
  if (!questions.length || responseList.length !== questions.length) throw new Error('Không nhận đủ câu trả lời để chấm điểm. Hãy dùng lại đường link bài tập mới nhất.');
  var responseMap = {};
  responseList.forEach(function (r) { responseMap[String(r.qid)] = r.answer; });
  var total = 0, got = 0, fullyCorrect = 0;
  questions.forEach(function (q) {
    if (!Object.prototype.hasOwnProperty.call(responseMap, String(q.id))) throw new Error('Thiếu câu trả lời. Hãy nộp lại bài.');
    var pts = Math.max(0, Number(q.points) || 0);
    var fraction = _fraction_(q, responseMap[String(q.id)]);
    total += pts; got += pts * fraction;
    if (fraction >= 1 - 1e-9) fullyCorrect++;
  });
  var mastery = questions.length ? fullyCorrect / questions.length * 100 : 0;
  var goal = assignment.mode === 'p' ? Number(assignment.goal) || 0 : 0;
  if (goal && mastery + 1e-9 < goal) throw new Error('Chưa đạt mục tiêu Làm chủ đã đặt. Hãy tiếp tục luyện tập rồi nộp lại.');
  var id = Utilities.getUuid().replace(/-/g, '');
  var record = {
    id: id, quizId: assignment.quizId, title: assignment.title || data.title || '', name: name,
    mode: assignment.mode || data.mode || 'c', got: Number(got.toFixed(2)), tot: Number(total.toFixed(2)),
    correct: fullyCorrect, n: questions.length, used: Math.max(0, Number(data.used) || 0), aid: aid,
    late: !!(assignment.end && now > Number(assignment.end)), goal: goal,
    pass: !!(goal && mastery + 1e-9 >= goal), masteryPct: Number(mastery.toFixed(2)), at: now
  };
  _upsert_('Attempts', id, aid, name, now, record);
  return id;
}

function quizLabApiQuestions(quizId, assignmentCode, key) {
  var aid = String(assignmentCode || '');
  if (!_canManageQuiz_(quizId, key)) {
    var assignment = aid && _find_('Assignments', aid);
    if (!assignment || String(assignment.data.quizId || assignment.relation) !== String(quizId)) throw new Error('Mã tham gia không khớp với đề.');
  }
  return _rows_('Questions').filter(function (r) { return r.relation === String(quizId); })
    .map(function (r) { return Object.assign({}, r.data, {id: r.id, order: Number(r.data.order != null ? r.data.order : r.label) || 0}); })
    .sort(function (a, b) { return a.order - b.order; });
}

function quizLabApiPlayersForCode(aid, key) {
  var code = String(aid || '');
  if (!_find_('Assignments', code)) return [];
  return _rows_('Players').filter(function (r) { return r.relation === code; })
    .map(function (r) { return Object.assign({}, _publicData_(r.data), {id: r.id}); });
}

function quizLabApiCountAttempts(aid, name) {
  var code = String(aid || '');
  if (!_find_('Assignments', code)) throw new Error('Mã bài tập không tồn tại.');
  var normalized = _cleanName_(name).toLocaleLowerCase();
  return _rows_('Attempts').filter(function (r) {
    return r.relation === code && String(r.label || '').trim().toLocaleLowerCase() === normalized;
  }).length;
}

function _validOwnerKey_(key) {
  var s = String(key || '');
  return /^[a-f0-9]{64}$/i.test(s) || quizLabApiIsTeacher(s);
}
function _canManageData_(data, key) {
  if (!data) return false;
  var k = String(key || '');
  if (data.ownerKey) return _validOwnerKey_(k) && String(data.ownerKey) === k;
  // Legacy records created before the multi-creator update remain visible only to the old admin key.
  return quizLabApiIsTeacher(k);
}
function _ownsQuiz_(quizId, key) {
  var row = _find_('Quizzes', String(quizId || ''));
  return !!row && _canManageData_(row.data, key);
}
function _canManageQuiz_(quizId, key) { return _ownsQuiz_(quizId, key); }
function _ownsAssignment_(aid, key) {
  var row = _find_('Assignments', String(aid || ''));
  return !!row && _canManageData_(row.data, key);
}
function _publicData_(data) {
  var out = Object.assign({}, data || {});
  delete out.ownerKey;
  return out;
}
function _publicAssignment_(data) {
  // Hide creator token and return only the fields the learner needs to join and play.
  var allowed = ['quizId','title','n','mode','start','end','late','attempts','goal','qtries','reviewDelay','anon','showAns','after','shufQ','shufO','sfx','fun','created'];
  var out = {};
  allowed.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(data || {}, k)) out[k] = data[k]; });
  return out;
}

function _db_() {
  var id = PropertiesService.getScriptProperties().getProperty('QUIZLAB_SPREADSHEET_ID');
  if (!id) throw new Error('Chưa khởi tạo dữ liệu. Hãy mở Apps Script và chạy setupQuizLab() một lần.');
  return SpreadsheetApp.openById(id);
}
function _sheet_(name) {
  var sh = _db_().getSheetByName(name);
  if (!sh) throw new Error('Thiếu sheet ' + name + '. Hãy chạy setupQuizLab() lại.');
  return sh;
}
function _readData_(row) {
  var json = row.slice(4, 10).map(function (x) { return String(x || ''); }).join('');
  if (!json) return {};
  try { return JSON.parse(json); } catch (e) { throw new Error('Dữ liệu trong Google Sheets bị lỗi JSON.'); }
}
function _rows_(name) {
  var sh = _sheet_(name), values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).filter(function (r) { return r[0] !== '' && r[0] != null; }).map(function (r) {
    return {id: String(r[0]), relation: String(r[1] || ''), label: String(r[2] || ''), updatedAt: Number(r[3]) || 0, data: _readData_(r)};
  });
}
function _find_(name, id) {
  id = String(id || '');
  if (!id) return null;
  var rows = _rows_(name);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}
function _sheetRow_(item) {
  var json = JSON.stringify(item.data || {}), chunks = [];
  for (var i = 0; i < json.length; i += 44000) chunks.push(json.slice(i, i + 44000));
  if (chunks.length > 6) throw new Error('Một câu hỏi hoặc hình ảnh quá lớn để lưu. Hãy giảm kích thước ảnh rồi thử lại.');
  while (chunks.length < 6) chunks.push('');
  return [String(item.id), String(item.relation || ''), String(item.label || ''), Number(item.updatedAt) || Date.now()].concat(chunks);
}

/** Write one or many records while holding the global script lock only once. */
function _upsertMany_(items) {
  if (!Array.isArray(items) || !items.length) return true;
  var grouped = {}, order = [];
  items.forEach(function (item) {
    if (!item || !item.table || !item.id) throw new Error('Thiếu bảng hoặc ID khi lưu dữ liệu.');
    if (!grouped[item.table]) { grouped[item.table] = {}; order.push(item.table); }
    // If a batch repeats an ID, the last item is the intended final version.
    grouped[item.table][String(item.id)] = {item:item, row:_sheetRow_(item)};
  });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error('Quiz Lab đang ghi dữ liệu từ một thao tác khác. Hãy chờ vài giây rồi thử lại.');
  }
  try {
    order.forEach(function (tableName) {
      var sh = _sheet_(tableName), last = sh.getLastRow(), rowById = {};
      if (last >= 2) {
        var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
        for (var i = 0; i < ids.length; i++) {
          var currentId = String(ids[i][0] || '');
          if (currentId) rowById[currentId] = i + 2;
        }
      }
      var entries = Object.keys(grouped[tableName]).map(function (id) { return grouped[tableName][id]; });
      var updates = [], appends = [];
      entries.forEach(function (entry) {
        var id = String(entry.item.id), existingRow = rowById[id];
        if (existingRow) updates.push({row:existingRow, values:entry.row});
        else appends.push(entry.row);
      });
      updates.sort(function (a, b) { return a.row - b.row; });
      // Combine adjacent rows into a single setValues call where possible.
      for (var u = 0; u < updates.length;) {
        var v = u + 1;
        while (v < updates.length && updates[v].row === updates[v - 1].row + 1) v++;
        sh.getRange(updates[u].row, 1, v - u, 10).setValues(updates.slice(u, v).map(function (x) { return x.values; }));
        u = v;
      }
      if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, 10).setValues(appends);
    });
  } finally {
    lock.releaseLock();
  }
  return true;
}

function _upsert_(name, id, relation, label, updatedAt, data) {
  return _upsertMany_([{table:name, id:String(id), relation:relation, label:label, updatedAt:updatedAt, data:data}]);
}

function _delete_(name, id) {
  var sh = _sheet_(name), last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return true; }
  return false;
}
function _quizHasAssignment_(quizId) {
  return _rows_('Assignments').some(function (r) { return String(r.data.quizId || r.relation) === String(quizId); });
}
function _cleanName_(name) {
  return String(name == null ? '' : name).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 30);
}
function _slug_(name) {
  return String(name || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'x';
}
function _norm_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function _matchShort_(answer, expected) {
  var a = _norm_(answer);
  if (!a) return false;
  return String(expected == null ? '' : expected).split(/[;|]/).map(_norm_).filter(Boolean).some(function (k) {
    if (a === k) return true;
    var a2 = a.replace(/,/g, '.'), k2 = k.replace(/,/g, '.');
    if (!/^[-+]?\d+(\.\d+)?$/.test(a2) || !/^[-+]?\d+(\.\d+)?$/.test(k2)) return false;
    return Math.abs(Number(a2) - Number(k2)) < 1e-9;
  });
}
function _fraction_(q, answer) {
  if (q.type === 'mc') return Number(answer) === Number(q.correct) ? 1 : 0;
  if (q.type === 'sa') return _matchShort_(answer, q.answer) ? 1 : 0;
  if (q.type === 'tf') {
    var items = Array.isArray(q.items) ? q.items : [];
    var answers = Array.isArray(answer) ? answer : [];
    if (!items.length) return 0;
    var correct = 0;
    items.forEach(function (item, i) { if (answers[i] === item.answer) correct++; });
    return correct / items.length;
  }
  return 0;
}
