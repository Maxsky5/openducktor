pub(crate) struct RuntimeProcessGuard {
    _handle: Box<dyn Send>,
}

impl RuntimeProcessGuard {
    pub(crate) fn new<H>(handle: H) -> Self
    where
        H: Send + 'static,
    {
        Self {
            _handle: Box::new(handle),
        }
    }
}
