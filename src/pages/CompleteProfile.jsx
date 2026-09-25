import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function CompleteProfile() {
  const { user, profile, profileLoading, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!profileLoading && profile) navigate('/', { replace: true })
  }, [profileLoading, profile, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!fullName.trim() || !phone.trim()) {
      setError('Please fill in both fields.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('users').insert({
      id: user.id,
      full_name: fullName.trim(),
      phone: phone.trim(),
    })
    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    await refreshProfile()
    navigate('/', { replace: true })
  }

  if (profileLoading || profile) {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <span className="brand-mark auth-mark" />
        <h1>Just a couple of details</h1>
        <p className="auth-subtitle">
          Tell us who you are before you book a time slot.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field">
            <span>Full name</span>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </label>

          <label className="field">
            <span>Phone number</span>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              autoComplete="tel"
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
