const debounce = (func, timeout = 300) => {
    let timer
    return (...args) => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            func.apply(this, args)
        }, timeout)
    }
}

const getData = (search, success, error, always) => {
    const params = new URLSearchParams({ term: search })

    const xhr = new XMLHttpRequest()
    xhr.open('GET', `/Data/SearchFolder?${params}`)
    xhr.responseType = 'json'

    xhr.onload = function () {
        const data = xhr.response
        console.table(data)

        success && success(data)
        always && always()
    }

    xhr.onerror = function () {
        error && error()
        always && always()
    }

    xhr.send()
}

const mod = (n, m) => ((n % m) + m) % m

const SearchElementInput = (id, name) => ({
    search: '',
    data: [],
    open: false,
    loading: false,
    selectedId: null,
    selectedItem: undefined,
    selectionIndex: 0,
    onTyping() {
        if (this.search === '') return

        this.loading = true
        this.open = true
        this.data = []
    },
    onSearch() {
        if (this.search === '') return

        getData(
            this.search,
            (data) => {
                this.data = data
            },
            undefined,
            () => (this.loading = false)
        )
    },
    selectFolder(index) {
        const item = this.data[index]

        this.selectedItem = item
        this.selectedId = item.id
        this.search = item.name

        this.close()
    },
    changeSelection(direction) {
        this.selectionIndex = mod(this.selectionIndex + direction, this.data.length)
    },
    cancel() {
        this.close()

        if (!this.selectedItem) {
            this.search = ''
            this.selectedId = undefined
            return
        }

        this.search = this.selectedItem.name
    },
    close() {
        this.open = false
    },
    init() {
        console.log(name)
        this.selectedId = id
        this.search = name
        this.selectedItem = { id, name }
    },
})

export default SearchElementInput
