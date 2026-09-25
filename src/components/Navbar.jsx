import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, profile, signOut } = useAuth()

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <span className="brand">
          <span className="brand-mark" />
          Leads Generation
        </span>
        {user && (
          <div className="navbar-right">
            <span className="navbar-email">{profile?.full_name ?? user.email}</span>
            <button className="btn btn-ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
