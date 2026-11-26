/**
 * Local draft for Create Task.
 * Stores answers and the current page only. Task IDs are allocated on submit.
 */
var AdminTaskDraft = (function () {
  var KEY = 'scs_admin_task_draft';

  function blankAction() {
    return { description: '', owner: '', dueDate: '', priority: '' };
  }

  function createSubmissionId() {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var rand = Math.random() * 16 | 0;
      var value = ch === 'x' ? rand : (rand & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function cleanAction(action) {
    var source = action || {};
    return {
      description: String(source.description || ''),
      owner: String(source.owner || ''),
      dueDate: String(source.dueDate || ''),
      priority: String(source.priority || '')
    };
  }

  function isMeaningful(state) {
    if (!state) return false;
    if (Number(state.step) > 0) return true;
    if (String(state.taskAreaValue || '').trim()) return true;
    if (String(state.title || '').trim()) return true;
    if (String(state.description || '').trim()) return true;
    var actions = state.actions || [];
    for (var i = 0; i < actions.length; i++) {
      var action = actions[i] || {};
      if (String(action.description || '').trim() ||
          String(action.owner || '').trim() ||
          String(action.dueDate || '').trim() ||
          String(action.priority || '').trim()) {
        return true;
      }
    }
    return false;
  }

  function snapshot(state) {
    var source = state || {};
    var step = Number(source.step);
    if (step !== 1 && step !== 2) step = 0;
    var actions = Array.isArray(source.actions) && source.actions.length
      ? source.actions.map(cleanAction)
      : [blankAction()];
    return {
      step: step,
      taskAreaValue: String(source.taskAreaValue || ''),
      title: String(source.title || ''),
      description: String(source.description || ''),
      actions: actions,
      submissionId: String(source.submissionId || '')
    };
  }

  function read(storage) {
    if (!storage) return null;
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var state = snapshot(parsed);
      if (!/^[A-Za-z0-9-]{8,80}$/.test(state.submissionId)) return null;
      if (!isMeaningful(state)) return null;
      return state;
    } catch (err) {
      return null;
    }
  }

  function write(storage, state) {
    if (!storage) return;
    var data = snapshot(state);
    if (!isMeaningful(data) || !/^[A-Za-z0-9-]{8,80}$/.test(data.submissionId)) {
      try { storage.removeItem(KEY); } catch (err) {}
      return;
    }
    storage.setItem(KEY, JSON.stringify(data));
  }

  function clear(storage) {
    if (!storage) return;
    try { storage.removeItem(KEY); } catch (err) {}
  }

  function recoveryChoice(choice, confirmed) {
    if (choice === 'continue') return 'continue';
    if (choice === 'start-new' && confirmed) return 'discard';
    if (choice === 'start-new') return 'confirm';
    return 'prompt';
  }

  function blankState() {
    return {
      step: 0,
      taskAreaValue: '',
      title: '',
      description: '',
      actions: [blankAction()],
      submissionId: createSubmissionId()
    };
  }

  return {
    KEY: KEY,
    blankAction: blankAction,
    blankState: blankState,
    createSubmissionId: createSubmissionId,
    isMeaningful: isMeaningful,
    snapshot: snapshot,
    read: read,
    write: write,
    clear: clear,
    recoveryChoice: recoveryChoice
  };
})();
