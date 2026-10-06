import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Modaler Dialog als Bottom-Sheet. label = zugänglicher Name. dirty = Schließen per Escape/Hintergrund/Wischen fragt nach.
// Zuziehen nur ueber den Griff: Wischen im Inhalt soll scrollen, nicht schliessen.
export default function Sheet({ open, onClose, label, dirty = false, children }) {
  const close = () => { if (!dirty || confirm('Änderungen verwerfen?')) onClose() }
  return createPortal(
    <AnimatePresence>{open && <Panel key="sheet" close={close} label={label}>{children}</Panel>}</AnimatePresence>,
    document.body
  )
}

function Panel({ close, label, children }) {
  const drag = useDragControls()
  const reduce = useReducedMotion()
  const layer = useRef(null)
  const dialog = useRef(null)
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const trigger = document.activeElement
    // Hintergrund inert (auch frühere Sheets), Scrollen sperren; beim Schließen genau das zurücknehmen.
    const others = [...document.body.children].filter((el) => el !== layer.current && !el.hasAttribute('inert'))
    others.forEach((el) => el.setAttribute('inert', ''))
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current.focus()
    return () => {
      others.forEach((el) => el.removeAttribute('inert'))
      document.body.style.overflow = overflow
      // Auslöser weg (z. B. Liste neu gerendert)? Dann auf den Hauptbereich.
      const target = trigger?.isConnected && !trigger.closest('[inert]') ? trigger : document.querySelector('main')
      if (target) {
        if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus()
      }
    }
  }, [])

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
    if (e.key !== 'Tab') return
    const items = [...dialog.current.querySelectorAll(FOCUSABLE)]
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div ref={layer} className="sheet-layer">
      <motion.div
        className="backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.18 }}
        onClick={() => closeRef.current()}
      />
      <motion.div
        ref={dialog}
        className="sheet"
        role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onKeyDown={onKeyDown}
        initial={reduce ? { opacity: 0 } : { y: '100%' }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}
        drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0 }} dragElastic={0.05}
        onDragEnd={(e, info) => { if (info.offset.y > 80) closeRef.current() }}
      >
        <div className="grip-zone" onPointerDown={(e) => drag.start(e)} aria-hidden="true"><div className="grip" /></div>
        <button type="button" className="sheet-close" aria-label="Schließen" onClick={() => closeRef.current()}>×</button>
        <div className="sheet-body">{children}</div>
      </motion.div>
    </div>
  )
}
