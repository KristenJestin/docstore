const toggleOverflow = (opened) => {
    const className = 'overflow-hidden'
    const classList = document.getElementsByTagName('body')[0].classList

    if (!opened) classList.remove(className)
    else classList.add(className)
}

const Modal = (open = false) => ({
    open: false,
    init() {
        this.open = open

        this.$watch('open', (opened) => toggleOverflow(opened))
    },
})

export default Modal
