import { useState } from 'react';
import { useDiagnostic } from '../DiagnosticContext';

const PROCESSES = [
  { id: 'customer-onboarding', name: 'Customer Onboarding', icon: '📦' },
  { id: 'sales-to-delivery', name: 'Sales to Delivery', icon: '💰' },
  { id: 'employee-onboarding', name: 'Employee Onboarding', icon: '👤' },
  { id: 'order-fulfillment', name: 'Order Fulfillment', icon: '✅' },
  { id: 'invoice-to-payment', name: 'Invoice to Payment', icon: '💳' },
  { id: 'issue-resolution', name: 'Issue Resolution', icon: '🔧' },
  { id: 'approval-workflow', name: 'Approval Workflow', icon: '📋' },
  { id: 'product-launch', name: 'Product Launch', icon: '🚀' },
  { id: 'reporting-cycle', name: 'Reporting Cycle', icon: '📊' },
];

export default function ScreenProcessSelection() {
  const { processData, goToScreen, setProcessType } = useDiagnostic();
  const [selectedId, setSelectedId] = useState(processData.processType || '');
  const [customValue, setCustomValue] = useState(
    processData.processType === 'custom' ? processData.processName : ''
  );

  const canContinue = selectedId || customValue.trim();

  const handleSelect = (id, name) => {
    setSelectedId(id);
    setCustomValue('');
    setProcessType(id, name);
  };

  const handleCustomChange = (e) => {
    const v = e.target.value.trim();
    setCustomValue(v);
    if (v) {
      setSelectedId('');
      setProcessType('custom', v);
    }
  };

  const handleContinue = () => {
    if (canContinue) goToScreen(2);
  };

  return (
    <div className="diag-screen-card">
      <h2 className="diag-screen-title">Select Your Process</h2>
      <p className="diag-screen-subtitle">Which process causes you the most pain?</p>

      <div className="diag-process-grid">
        {PROCESSES.map((p) => (
          <div
            key={p.id}
            className={`diag-process-card ${selectedId === p.id ? 'selected' : ''}`}
            onClick={() => handleSelect(p.id, p.name)}
          >
            <div className="diag-process-icon">{p.icon}</div>
            <div className="diag-process-name">{p.name}</div>
          </div>
        ))}
      </div>

      <div className="diag-form-group" style={{ marginTop: '2rem' }}>
        <label>Or describe your own:</label>
        <input
          type="text"
          placeholder="e.g., Quote to Contract"
          value={customValue}
          onChange={handleCustomChange}
        />
      </div>

      <div className="diag-button-group">
        <button className="diag-btn diag-btn-secondary" onClick={() => goToScreen(0)}>
          ← Back
        </button>
        <button
          className="diag-btn diag-btn-primary"
          onClick={handleContinue}
          disabled={!canContinue}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
