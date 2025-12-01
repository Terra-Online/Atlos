// Fixed TypeScript errors
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { getStorageTreeMapData, TreeMapNode } from '@/utils/storage';
import styles from './treeMap.module.scss';

interface CustomHierarchyRectangularNode extends d3.HierarchyRectangularNode<TreeMapNode> {
  realValue?: number;
  leafUid?: string;
  clipUid?: string;
  target?: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  };
}

interface CustomHierarchyNode extends d3.HierarchyNode<TreeMapNode> {
  realValue?: number;
  value?: number;
}

interface TreeMapProps {
  onSelect?: (path: string[], name: string) => void;
  refreshTrigger?: number;
}

const formatSize = (bytes: number): string => {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${bytes} B`;
};

const formatName = (str: string): string => {
  return str.split(/[\s-]+/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
};

const TreeMap: React.FC<TreeMapProps> = ({ onSelect, refreshTrigger = 0 }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [treeData, setTreeData] = useState<TreeMapNode | null>(null);

  useEffect(() => {
    getStorageTreeMapData().then(children => {
      setTreeData({
        name: "Storage",
        children: children // No longer processing nodes to preserve raw names/ids
      });
    }).catch(console.error);
  }, [refreshTrigger]);

  const handleNodeClick = useCallback((d: CustomHierarchyRectangularNode) => {
    // Construct path from root to current node
    // Use 'id' if available (for URLs), otherwise 'name'
    const path = d.ancestors().reverse().map(node => node.data.id || node.data.name);
    
    // Remove the root "Storage" from the path
    if (path.length > 0 && path[0] === "Storage") {
      path.shift();
    }

    if (path.length === 0) return;

    if (onSelect) {
      onSelect(path, formatName(d.data.name));
    }
  }, [onSelect]);

  useEffect(() => {
    if (!svgRef.current || !wrapperRef.current || !treeData) return;

    // Clear previous render
    d3.select(svgRef.current).selectAll('*').remove();

    const width = wrapperRef.current.clientWidth || 928;
    const totalHeight = wrapperRef.current.clientHeight || 400;
    const height = totalHeight - 30;

    function tile(node: d3.HierarchyRectangularNode<TreeMapNode>, x0: number, y0: number, x1: number, y1: number) {
      d3.treemapBinary(node, 0, 0, width, height);
      if (node.children) {
        for (const child of node.children) {
          child.x0 = x0 + child.x0 / width * (x1 - x0);
          child.x1 = x0 + child.x1 / width * (x1 - x0);
          child.y0 = y0 + child.y0 / height * (y1 - y0);
          child.y1 = y0 + child.y1 / height * (y1 - y0);
        }
      }
    }

    const hierarchy = d3.hierarchy<TreeMapNode>(treeData)
      .sum(d => d.value || 0) as CustomHierarchyNode;

    // Store real values and clamp visual values
    hierarchy.each((d) => { d.realValue = d.value; });
    
    hierarchy.eachAfter((d) => {
      if (d.children) {
        const validValues = d.children.map(c => c.value || 0).filter(v => v > 0);
        if (validValues.length > 0) {
          const minVal = Math.min(...validValues);
          d.children.forEach(c => {
            if ((c.value || 0) > minVal * 5) {
              c.value = minVal * 5;
            }
          });
          d.value = d.children.reduce((acc, c) => acc + (c.value || 0), 0);
        }
      }
    });

    hierarchy.sort((a, b) => (b.value || 0) - (a.value || 0));

    const root = d3.treemap<TreeMapNode>().tile(tile)(hierarchy) as CustomHierarchyRectangularNode;

    const x = d3.scaleLinear().rangeRound([0, width]);
    const y = d3.scaleLinear().rangeRound([0, height]);

    const name = (d: CustomHierarchyRectangularNode) => d.ancestors().reverse().map(d => formatName(d.data.name)).join("/");

    const svg = d3.select(svgRef.current)
        .attr("viewBox", [0.5, -30.5, width, height + 30])
        .attr("class", styles.svg);

    let group = svg.append("g")
        .call(render, root);

    function render(group: d3.Selection<SVGGElement, unknown, null, undefined>, root: CustomHierarchyRectangularNode) {
      const node = group
        .selectAll("g")
        .data(root.children ? root.children.concat(root) : [root])
        .join("g");

      node.filter(d => d === root ? !!d.parent : !!d.children)
          .attr("class", styles.node)
          .on("click", (_event, d) => {
            handleNodeClick(d);
            return d === root ? zoomout(root) : zoomin(d);
          });

      // Add click handler for leaf nodes (items that can be deleted)
      node.filter(d => !d.children && d !== root)
          .attr("class", `${styles.node} ${styles.leaf}`)
          .style("cursor", "pointer")
          .on("click", (_event, d) => { handleNodeClick(d); });

      node.append("title")
          .text(d => `${name(d)}\n${formatSize(d.realValue || 0)}`);

      node.append("rect")
          .attr("id", d => (d.leafUid = `leaf-${Math.random().toString(36).substr(2, 9)}`))
          .attr("class", d => {
             if (d === root) return `${styles.rect} ${styles.rectRoot}`;
             if (d.children) return `${styles.rect} ${styles.rectParent}`;
             return `${styles.rect} ${styles.rectLeaf}`;
          });

      node.append("clipPath")
          .attr("id", d => (d.clipUid = `clip-${Math.random().toString(36).substr(2, 9)}`))
        .append("use")
          .attr("xlink:href", d => `#${d.leafUid}`);

      node.append("text")
          .attr("clip-path", d => `url(#${d.clipUid})`)
          .attr("class", d => d === root ? `${styles.text} ${styles.textRoot}` : styles.text)
          .each(function(d) {
            const textElement = d3.select(this);
            const rectWidth = (d === root ? width : x(d.x1) - x(d.x0)) - 8;
            const nameStr = d === root ? name(d) : formatName(d.data.name);
            const sizeStr = formatSize(d.realValue || 0);
            
            const lineHeight = 1.1;
            const yOffset = 1.1;
            
            let tspan = textElement.append("tspan")
              .attr("x", 3)
              .attr("y", `${yOffset}em`)
              .attr("class", styles.tspanName);
            
            tspan.text(nameStr);
            
            const textLength = tspan.node()?.getComputedTextLength() || 0;
            
            if (textLength > rectWidth) {
              tspan.text("");
              let line: string[] = [];
              let lineNumber = 0;
              
              for (let i = 0; i < nameStr.length; i++) {
                const char = nameStr[i];
                line.push(char);
                tspan.text(line.join(""));
                
                if ((tspan.node()?.getComputedTextLength() || 0) > rectWidth) {
                  line.pop();
                  if (line.length > 0) {
                     tspan.text(line.join("") + "-");
                  }
                  
                  line = [char];
                  lineNumber++;
                  tspan = textElement.append("tspan")
                    .attr("x", 3)
                    .attr("y", `${yOffset + lineNumber * lineHeight}em`)
                    .attr("class", styles.tspanName)
                    .text(char);
                }
              }
              
              textElement.append("tspan")
                .attr("x", 3)
                .attr("y", `${yOffset + (lineNumber + 1) * lineHeight}em`)
                .attr("class", styles.tspanValue)
                .text(sizeStr);
                
            } else {
              textElement.append("tspan")
                .attr("x", 3)
                .attr("y", `${yOffset + lineHeight}em`)
                .attr("class", styles.tspanValue)
                .text(sizeStr);
            }
          });

      group.call(position, root);
    }

    function position(group: d3.Selection<SVGGElement, unknown, null, undefined> | d3.Transition<SVGGElement, unknown, null, undefined>, root: CustomHierarchyRectangularNode) {
      const g = group as d3.Selection<SVGGElement, unknown, null, undefined>;
      g.selectAll("g")
          .attr("transform", (d: unknown) => {
            const node = d as CustomHierarchyRectangularNode;
            return node === root ? `translate(0,-30)` : `translate(${x(node.x0)},${y(node.y0)})`;
          })
        .select("rect")
          .attr("width", (d: unknown) => {
            const node = d as CustomHierarchyRectangularNode;
            return node === root ? width : x(node.x1) - x(node.x0);
          })
          .attr("height", (d: unknown) => {
            const node = d as CustomHierarchyRectangularNode;
            return node === root ? 30 : y(node.y1) - y(node.y0);
          });
    }

    function zoomin(d: CustomHierarchyRectangularNode) {
      const parent = d.parent;
      if (!parent) return;

      const group0 = group.attr("pointer-events", "none");
      const group1 = group = svg.append("g").call(render, d);

      x.domain([d.x0, d.x1]);
      y.domain([d.y0, d.y1]);

      const duration = parseInt(styles.animDuration) || 750;
      const ease = (d3 as unknown as Record<string, (t: number) => number>)[styles.animEase] || d3.easeCubic;

      svg.transition()
          .duration(duration)
          .ease(ease)
          .call(t => group0.transition(t as unknown as string).remove()
            .call(position, parent))
          .call(t => group1.transition(t as unknown as string)
            .attrTween("opacity", () => d3.interpolate("0", "1"))
            .call(position, d));
    }

    function zoomout(d: CustomHierarchyRectangularNode) {
      const parent = d.parent;
      if (!parent) return;

      const group0 = group.attr("pointer-events", "none");
      const group1 = group = svg.insert("g", "*").call(render, parent);

      x.domain([parent.x0, parent.x1]);
      y.domain([parent.y0, parent.y1]);

      const duration = parseInt(styles.animDuration) || 750;
      const ease = (d3 as unknown as Record<string, (t: number) => number>)[styles.animEase] || d3.easeCubic;

      svg.transition()
          .duration(duration)
          .ease(ease)
          .call(t => group0.transition(t as unknown as string).remove()
            .attrTween("opacity", () => d3.interpolate("1", "0"))
            .call(position, d))
          .call(t => group1.transition(t as unknown as string)
            .call(position, parent));
    }

  }, [treeData, handleNodeClick]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <svg ref={svgRef} />
    </div>
  );
};

export default TreeMap;