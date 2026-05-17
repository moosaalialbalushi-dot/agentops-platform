import React from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  xl?: boolean;
}

export function Modal({ title, onClose, children, wide, xl }: ModalProps) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""} ${xl ? "modal-xl" : ""}`} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div className="modal-title">{title}</div>
          <button className="icon-btn" style={{ fontSize: 17 }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
