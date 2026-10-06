import { AnimatePresence, motion, useDragControls } from 'framer-motion'

// Zuziehen nur ueber den Griff: Wischen im Inhalt soll scrollen, nicht schliessen.
export default function Sheet({ open, onClose, children }) {
  const drag = useDragControls()
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="sheet"
            role="dialog"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0 }} dragElastic={0.05}
            onDragEnd={(e, info) => { if (info.offset.y > 80) onClose() }}
          >
            <div className="grip-zone" onPointerDown={(e) => drag.start(e)} aria-label="Zuziehen"><div className="grip" /></div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
