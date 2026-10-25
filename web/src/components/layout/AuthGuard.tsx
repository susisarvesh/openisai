/**
 * Layout wrapper. Authentication is removed: every route opens the app.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
