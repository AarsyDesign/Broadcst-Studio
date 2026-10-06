use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Fixed-capacity ring buffer for passing audio samples from the capture thread to the mixer.
pub struct AudioRingBuffer {
    buffer: Vec<f32>,
    capacity: usize,
    read_pos: AtomicUsize,
    write_pos: AtomicUsize,
}

impl AudioRingBuffer {
    pub fn new(capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            buffer: vec![0.0; capacity],
            capacity,
            read_pos: AtomicUsize::new(0),
            write_pos: AtomicUsize::new(0),
        })
    }

    pub fn write_slice(&self, samples: &[f32]) -> usize {
        let mut written = 0;
        let mut w = self.write_pos.load(Ordering::Relaxed);
        let r = self.read_pos.load(Ordering::Acquire);

        for &sample in samples {
            let next_w = (w + 1) % self.capacity;
            if next_w == r {
                // Buffer overrun: discard or stop
                break;
            }
            // SAFETY: In single-producer scenarios, this is safe.
            unsafe {
                let ptr = self.buffer.as_ptr() as *mut f32;
                *ptr.add(w) = sample;
            }
            w = next_w;
            written += 1;
        }

        self.write_pos.store(w, Ordering::Release);
        written
    }

    pub fn read_slice(&self, out: &mut [f32]) -> usize {
        let mut read = 0;
        let mut r = self.read_pos.load(Ordering::Relaxed);
        let w = self.write_pos.load(Ordering::Acquire);

        for slot in out.iter_mut() {
            if r == w {
                break;
            }
            unsafe {
                let ptr = self.buffer.as_ptr();
                *slot = *ptr.add(r);
            }
            r = (r + 1) % self.capacity;
            read += 1;
        }

        self.read_pos.store(r, Ordering::Release);
        read
    }

    pub fn available(&self) -> usize {
        let w = self.write_pos.load(Ordering::Acquire);
        let r = self.read_pos.load(Ordering::Acquire);
        if w >= r {
            w - r
        } else {
            self.capacity - (r - w)
        }
    }
}
