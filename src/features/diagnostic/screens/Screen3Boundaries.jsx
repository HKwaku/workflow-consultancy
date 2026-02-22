import React, { useState } from 'react';
import { useDiagnostic } from '../DiagnosticContext';
import { COMPLEXITY_OPTIONS, DEFAULT_DEPARTMENTS } from '../constants';

export default function Screen3Boundaries() {
  const { processData, setProcessData, goToScreen, customDepartments, dispatch } = useDiagnostic();
  const [startsWhen, setStartsWhen] = useState(processData.definition?.startsWhen || '');
  const [completesWhen, setCompletesWhen] = useState(processData.definition?.completesWhen || '');
  const [complexity, setComplexity] = useState(processData.definition?.complexity || '');
  const [departments, setDepartments] = useState(processData.definition?.departments || []);
  const [customDept, setCustomDept] = useState('');
  const [error, setError] = useState('');

  const allDepts = [...DEFAULT_DEPARTMENTS, ...customDepartments];

  const toggleDept = (dept) => {
    setDepartments(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const addCustomDept = () => {
    const v = customDept.trim();
    if (!v || customDepartments.includes(v) || departments.includes(v)) return;
    dispatch({ type: 'SET_CUSTOM_DEPARTMENTS', payload: [...customDepartments, v] });
    setDepartments(prev => [...prev, v]);
    setCustomDept('');
  };

  const handleContinue = () => {
    setProcessData({
      definition: {
        startsWhen: startsWhen.trim(),
        completesWhen: completesWhen.trim(),
        complexity,
        departments,
      },
    });
    setError('');
    goToScreen(4);
  };

  return (
    <>
      <h2 className="screen-title">Define Process Boundaries</h2>
      <p className="screen-subtitle">Let's define "<span className="process-ref">{processData.processName || 'your process'}</span>" precisely.</p>

      <div className="form-group">
        <label htmlFor="processStarts">This process STARTS when:</label>
        <input
          id="processStarts"
          type="text"
          placeholder="e.g., Contract is signed"
          value={startsWhen}
          onChange={(e) => setStartsWhen(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="processCompletes">This process is COMPLETE when:</label>
        <input
          id="processCompletes"
          type="text"
          placeholder="e.g., Customer has full access and is using the product"
          value={completesWhen}
          onChange={(e) => setCompletesWhen(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>How many different people or roles need to be involved?</label>
        <div className="radio-group">
          {COMPLEXITY_OPTIONS.map((opt) => (
            <label key={opt.value} className={`radio-option ${complexity === opt.value ? 'selected' : ''}`}>
              <input
                type="radio"
                name="complexity"
                value={opt.value}
                checked={complexity === opt.value}
                onChange={() => setComplexity(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>This process typically involves which departments?</label>
        <div className="checkbox-group">
          {allDepts.map((dept) => (
            <label key={dept} className="checkbox-option">
              <input
                type="checkbox"
                checked={departments.includes(dept)}
                onChange={() => toggleDept(dept)}
              />
              {dept}
            </label>
          ))}
          <div className="custom-dept-input-row">
            <input
              type="text"
              placeholder="Add a custom department or team..."
              className="custom-dept-text-input"
              value={customDept}
              onChange={(e) => setCustomDept(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomDept())}
            />
            <button type="button" className="custom-dept-add-btn" onClick={addCustomDept} title="Add department">+</button>
          </div>
        </div>
      </div>

      {error && <div className="error-box"><div className="error-text">{error}</div></div>}

      <div className="button-group">
        <button className="button button-secondary" onClick={() => goToScreen(2)}>&larr; Back</button>
        <button className="button button-primary" onClick={handleContinue}>Continue &rarr;</button>
      </div>
    </>
  );
}
