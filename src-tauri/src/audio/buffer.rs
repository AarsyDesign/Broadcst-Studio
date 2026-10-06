use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// SPSC Producer handle for the real-time audio callback.
pub struct AudioProducer {
    producer: Producer<f32>,
    overrun_count: Arc<AtomicU64>,
}

impl AudioProducer {
    /// Push a slice of audio samples. If the ring buffer is full,
    /// write as many as possible without blocking, drop remaining samples,
    /// and increment the atomic overrun counter.
    /// Real-time safe: Zero locks, zero allocations.
    #[inline]
    pub fn push_slice(&mut self, samples: &[f32]) -> usize {
        let mut written = 0;
        for &sample in samples {
            match self.producer.push(sample) {
                Ok(()) => {
                    written += 1;
                }
                Err(_) => {
                    // Buffer is full: record overrun and drop remaining samples
                    let dropped = samples.len() - written;
                    self.overrun_count
                        .fetch_add(dropped as u64, Ordering::Relaxed);
                    break;
                }
            }
        }
        written
    }

    #[inline]
    pub fn slots(&self) -> usize {
        self.producer.slots()
    }
}

/// SPSC Consumer handle for the audio engine thread.
pub struct AudioConsumer {
    consumer: Consumer<f32>,
    underrun_count: Arc<AtomicU64>,
}

impl AudioConsumer {
    /// Read into a slice of audio samples. If fewer samples are available than requested,
    /// remaining slots are filled with 0.0 (silence) and the underrun counter is incremented.
    /// Real-time safe: Zero locks, zero allocations.
    #[inline]
    pub fn pop_slice(&mut self, out: &mut [f32]) -> usize {
        let mut read = 0;
        for slot in out.iter_mut() {
            match self.consumer.pop() {
                Ok(sample) => {
                    *slot = sample;
                    read += 1;
                }
                Err(_) => {
                    // Buffer underrun: fill remaining with silence
                    *slot = 0.0;
                }
            }
        }

        if read < out.len() {
            let underrun = (out.len() - read) as u64;
            self.underrun_count.fetch_add(underrun, Ordering::Relaxed);
        }

        read
    }

    #[inline]
    pub fn available(&self) -> usize {
        self.consumer.slots()
    }
}

pub fn create_audio_ring_buffer(
    capacity: usize,
) -> (AudioProducer, AudioConsumer, Arc<AtomicU64>, Arc<AtomicU64>) {
    let (producer, consumer) = RingBuffer::new(capacity);
    let overrun_count = Arc::new(AtomicU64::new(0));
    let underrun_count = Arc::new(AtomicU64::new(0));

    let audio_producer = AudioProducer {
        producer,
        overrun_count: overrun_count.clone(),
    };

    let audio_consumer = AudioConsumer {
        consumer,
        underrun_count: underrun_count.clone(),
    };

    (
        audio_producer,
        audio_consumer,
        overrun_count,
        underrun_count,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_buffer_write_read() {
        let (mut prod, mut cons, overruns, underruns) = create_audio_ring_buffer(16);
        let input = [1.0, 2.0, 3.0, 4.0];
        let written = prod.push_slice(&input);
        assert_eq!(written, 4);
        assert_eq!(overruns.load(Ordering::Relaxed), 0);

        let mut output = [0.0; 4];
        let read = cons.pop_slice(&mut output);
        assert_eq!(read, 4);
        assert_eq!(output, input);
        assert_eq!(underruns.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_ring_buffer_overrun() {
        let (mut prod, _cons, overruns, _) = create_audio_ring_buffer(4);
        let input = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let written = prod.push_slice(&input);
        assert_eq!(written, 4);
        assert_eq!(overruns.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn test_ring_buffer_underrun() {
        let (mut prod, mut cons, _, underruns) = create_audio_ring_buffer(8);
        prod.push_slice(&[0.5, 0.75]);

        let mut output = [0.0; 4];
        let read = cons.pop_slice(&mut output);
        assert_eq!(read, 2);
        assert_eq!(output[0], 0.5);
        assert_eq!(output[1], 0.75);
        assert_eq!(output[2], 0.0);
        assert_eq!(output[3], 0.0);
        assert_eq!(underruns.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn test_ring_buffer_wraparound() {
        let (mut prod, mut cons, _, _) = create_audio_ring_buffer(4);

        for i in 0..10 {
            let val = i as f32;
            prod.push_slice(&[val]);
            let mut out = [0.0; 1];
            cons.pop_slice(&mut out);
            assert_eq!(out[0], val);
        }
    }

    #[test]
    fn test_ring_buffer_concurrent_producer_consumer() {
        let (mut prod, mut cons, overruns, _underruns) = create_audio_ring_buffer(1024);
        let total_samples = 10_000;

        let prod_handle = std::thread::spawn(move || {
            let chunk = [1.0f32; 64];
            let mut sent = 0;
            while sent < total_samples {
                let to_write = (total_samples - sent).min(chunk.len());
                while prod.slots() < to_write {
                    std::thread::yield_now();
                }
                let written = prod.push_slice(&chunk[..to_write]);
                sent += written;
            }
        });

        let cons_handle = std::thread::spawn(move || {
            let mut buf = [0.0f32; 64];
            let mut received = 0;
            while received < total_samples {
                let available = cons.available();
                if available > 0 {
                    let to_read = (total_samples - received).min(buf.len()).min(available);
                    let read = cons.pop_slice(&mut buf[..to_read]);
                    received += read;
                } else {
                    std::thread::yield_now();
                }
            }
            received
        });

        prod_handle.join().unwrap();
        let received = cons_handle.join().unwrap();
        assert_eq!(received, total_samples);
        assert_eq!(overruns.load(Ordering::Relaxed), 0);
    }
}
