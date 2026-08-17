/**
 * Input Components — Liquid Glass Design System
 */

import React, { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import "./Input.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, iconLeft, iconRight, fullWidth = false, className = "", id, ...props }, ref) => {
    const inputId = id || React.useId();
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;

    const classNames = ["input-wrapper", fullWidth && "input-wrapper--full", error && "input-wrapper--error", className]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={classNames}>
        {label && <label htmlFor={inputId} className="input__label">{label}</label>}
        <div className="input__field">
          {iconLeft && <span className="input__icon input__icon--left" aria-hidden="true">{iconLeft}</span>}
          <input
            ref={ref}
            id={inputId}
            className="input"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : helperId}
            {...props}
          />
          {iconRight && <span className="input__icon input__icon--right" aria-hidden="true">{iconRight}</span>}
        </div>
        {error && <span id={errorId} className="input__error" role="alert">{error}</span>}
        {helperText && !error && <span id={helperId} className="input__helper">{helperText}</span>}
      </div>
    );
  }
);

Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, fullWidth = false, autoResize = true, className = "", id, ...props }, ref) => {
    const textareaId = id || React.useId();
    const errorId = error ? `${textareaId}-error` : undefined;
    const helperId = helperText ? `${textareaId}-helper` : undefined;

    const classNames = ["input-wrapper", fullWidth && "input-wrapper--full", error && "input-wrapper--error", className]
      .filter(Boolean)
      .join(" ");

    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const [height, setHeight] = React.useState<number | string>("auto");

    React.useImperativeHandle(ref, () => ({
      ...textareaRef.current,
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
    }));

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        textareaRef.current!.style.height = "auto";
        const newHeight = textareaRef.current!.scrollHeight;
        textareaRef.current!.style.height = `${newHeight}px`;
      }
      props.onChange?.(e);
    };

    return (
      <div className={classNames}>
        {label && <label htmlFor={textareaId} className="input__label">{label}</label>}
        <div className="input__field">
          <textarea
            ref={textareaRef}
            id={textareaId}
            className="input input--textarea"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : helperId}
            onChange={handleChange}
            style={{ height: autoResize ? height : undefined }}
            {...props}
          />
        </div>
        {error && <span id={errorId} className="input__error" role="alert">{error}</span>}
        {helperText && !error && <span id={helperId} className="input__helper">{helperText}</span>}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

/** Select Component */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  fullWidth?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, placeholder, options, fullWidth = false, className = "", id, ...props }, ref) => {
    const selectId = id || React.useId();
    const errorId = error ? `${selectId}-error` : undefined;
    const helperId = helperText ? `${selectId}-helper` : undefined;

    const classNames = ["input-wrapper", fullWidth && "input-wrapper--full", error && "input-wrapper--error", className]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={classNames}>
        {label && <label htmlFor={selectId} className="input__label">{label}</label>}
        <div className="input__field input__field--select">
          <select
            ref={ref}
            id={selectId}
            className="input input--select"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : helperId}
            {...props}
          >
            {placeholder && <option value="" disabled>{placeholder}</option>}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="input__select-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </div>
        {error && <span id={errorId} className="input__error" role="alert">{error}</span>}
        {helperText && !error && <span id={helperId} className="input__helper">{helperText}</span>}
      </div>
    );
  }
);

Select.displayName = "Select";