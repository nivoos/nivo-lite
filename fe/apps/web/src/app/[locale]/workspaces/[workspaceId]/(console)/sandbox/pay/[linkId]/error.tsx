"use client"

import { SandboxErrorPage } from "@/features/pages/SandboxErrorPage"

type ErrorProps = { readonly reset: () => void }

/** The sandbox pay route's error boundary slot: the Sandbox page's own error page. */
const ErrorBoundary = (props: ErrorProps) => <SandboxErrorPage onRetry={props.reset} />

export default ErrorBoundary
