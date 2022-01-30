// main
const ToastHandler = () => ({
    toasts: [],
    visible: [],
    add(toast) {
        toast.id = Date.now()
        this.toasts.push(toast)
        this.fire(toast.id)
    },
    fire(id) {
        this.visible.push(this.toasts.find((toast) => toast.id == id))
        const timeShown = 5000 * this.visible.length
        setTimeout(() => {
            this.remove(id)
        }, timeShown)
    },
    remove(id) {
        const toast = this.visible.find((toast) => toast.id == id)
        const index = this.visible.indexOf(toast)
        this.visible.splice(index, 1)
    },
    addMultiple(toasts) {
        for (const toast of toasts) {
            this.add(toast)
        }
    },
})

// export
export default ToastHandler
