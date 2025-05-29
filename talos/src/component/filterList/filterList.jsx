import classNames from "classnames"
import { getItemIconUrl } from "../../utils/resource"
import { useFilter, useSwitchFilter } from "../mapContainer/store/marker"
import "./filterList.scss"
import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"

const FilterList = ({ isSidebarOpen }) => {
    const filterList = useFilter()
    const containerRef = useRef(null)
    const [showLeftMask, setShowLeftMask] = useState(false)
    const [showRightMask, setShowRightMask] = useState(false)

    const checkScroll = () => {
        const container = containerRef.current
        if (!container) return

        const { scrollLeft, scrollWidth, clientWidth } = container
        setShowLeftMask(scrollLeft > 0)
        setShowRightMask(scrollLeft < scrollWidth - clientWidth)
    }

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const handleWheel = (e) => {
            e.preventDefault()
            container.scrollLeft += e.deltaY
        }

        container.addEventListener('wheel', handleWheel, { passive: false })
        container.addEventListener('scroll', checkScroll)

        // 初始化检查
        checkScroll()

        return () => {
            container.removeEventListener('wheel', handleWheel)
            container.removeEventListener('scroll', checkScroll)
        }
    }, [])

    const switchFilter = useSwitchFilter();

    return <div className={classNames("main-filter-list", { "hidden": filterList.length === 0, "sidebar-open": isSidebarOpen })}>
        <div
            ref={containerRef}
            className={classNames("main-filter-content-container", showLeftMask && "left-mask-opacity", showRightMask && "right-mask-opacity")}
            style={{ width: `${Math.min(filterList.length * 72 + 8, 510)}px` }}
        >
            <div className="inner-container">
                <AnimatePresence>
                    {filterList.map((item) => (
                        <motion.img
                            key={item}
                            className="main-filter-content-item"
                            src={getItemIconUrl(item)}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3 }}
                            onClick={() => { switchFilter(item) }}
                        />
                    ))}
                </AnimatePresence>
            </div>

        </div>
    </div>
}

export default FilterList