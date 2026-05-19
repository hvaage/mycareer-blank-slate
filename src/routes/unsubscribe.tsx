import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Header } from '@/components/landing/Header'
import { Footer } from '@/components/landing/Footer'

export const Route = createFileRoute('/unsubscribe')({
  component: UnsubscribePage,
  head: () => ({
    meta: [
      { title: 'Meld av e-post — Karrierenmin' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
})

type State =
  | { status: 'loading' }
  | { status: 'valid' }
  | { status: 'already' }
  | { status: 'invalid' }
  | { status: 'success' }
  | { status: 'error'; message: string }

function UnsubscribePage() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (!t) {
      setState({ status: 'invalid' })
      return
    }
    setToken(t)
    fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setState({ status: 'invalid' })
          return
        }
        if (body.valid) setState({ status: 'valid' })
        else if (body.reason === 'already_unsubscribed')
          setState({ status: 'already' })
        else setState({ status: 'invalid' })
      })
      .catch(() => setState({ status: 'invalid' }))
  }, [])

  async function confirm() {
    if (!token) return
    setSubmitting(true)
    try {
      const res = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => ({}))
      if (body.success) setState({ status: 'success' })
      else if (body.reason === 'already_unsubscribed')
        setState({ status: 'already' })
      else
        setState({
          status: 'error',
          message: body.error || 'Noe gikk galt. Prøv igjen senere.',
        })
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-xl w-full px-6 py-20">
        <h1 className="text-3xl font-serif text-foreground">
          Meld av e-post
        </h1>

        {state.status === 'loading' && (
          <p className="mt-4 text-muted-foreground">Sjekker lenken…</p>
        )}

        {state.status === 'valid' && (
          <>
            <p className="mt-4 text-muted-foreground">
              Bekreft at du vil melde deg av all e-post fra Karrierenmin.
            </p>
            <button
              onClick={confirm}
              disabled={submitting}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? 'Melder av…' : 'Bekreft avmelding'}
            </button>
          </>
        )}

        {state.status === 'success' && (
          <p className="mt-4 text-muted-foreground">
            Du er nå meldt av. Vi sender deg ikke flere e-poster.
          </p>
        )}

        {state.status === 'already' && (
          <p className="mt-4 text-muted-foreground">
            Denne e-postadressen er allerede meldt av.
          </p>
        )}

        {state.status === 'invalid' && (
          <p className="mt-4 text-muted-foreground">
            Lenken er ugyldig eller utløpt. Kontakt hei@karrierenmin.no hvis du
            trenger hjelp.
          </p>
        )}

        {state.status === 'error' && (
          <p className="mt-4 text-destructive">{state.message}</p>
        )}
      </main>
      <Footer />
    </div>
  )
}
