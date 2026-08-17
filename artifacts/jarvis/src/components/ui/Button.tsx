/**
 * Button Component — Liquid Glass Design System
 */

import React, { forwardRef, ButtonHTMLAttributes } from "react";
import "./Button.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "glass";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      iconPosition = "left",
      fullWidth = false,
      disabled,
      children,
      className = "",
      style,
      ...props
    },
    ref
  ) => {
    const classNames = [
      "btn",
      `btn--${variant}`,
      `btn--${size}`,
      fullWidth && "btn--full",
      loading && "btn--loading",
      disabled && "btn--disabled",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={classNames}
        disabled={disabled || loading}
        style={style}
        {...props}
      >
        {loading && <span className="btn__spinner" aria-hidden="true" />}
        {!loading && icon && iconPosition === "left" && <span className="btn__icon">{icon}</span>}
        <span className="btn__text">{children}</span>
        {!loading && icon && iconPosition === "right" && <span className="btn__icon">{icon}</span>}
      </button>
    );
  }
);

Button.displayName = "Button";

/** Icon Button — compact square button for toolbars */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "glass";
  size?: "sm" | "md" | "lg";
  "aria-label": string;
  children: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "ghost", size = "md", "aria-label": ariaLabel, children, className = "", ...props }, ref) => {
    const classNames = ["btn", "btn--icon", `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(" ");

    return (
      <button
        ref={ref}
        className={classNames}
        aria-label={ariaLabel}
        {...props}
      >
        <span className="btn__icon">{children}</span>
      </button>
    );
  }
);

IconButton.displayName = "IconButton";

/** Button Group — for grouped actions */
export interface ButtonGroupProps {
  children: React.ReactNode;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  className = "",
  orientation = "horizontal",
}) => {
  const classNames = ["btn-group", `btn-group--${orientation}`, className].filter(Boolean).join(" ");

  return <div className={classNames} role="group">{children}</div>;
};