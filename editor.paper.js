var Base = paper.Base,
	PaperScope = paper.PaperScope,
	Item = paper.Item,
	Path = paper.Path,
	Group = paper.Group,
	Layer = paper.Layer,
	Segment = paper.Segment,
	Raster = paper.Raster,
	Tool = paper.Tool,
	Component = paper.Component,
	Point = paper.Point;

var path;
var types = ['point', 'handleIn', 'handleOut'];

/*function findHandle(point) {
	for (var i = 0, l = path.segments.length; i < l; i++) {
		for (var j = 0; j < 3; j++) {
			var type = types[j];
			var segment = path.segments[i];
			var segmentPoint = type == 'point'
					? segment.point
					: segment.point + segment[type];
			var distance = (point - segmentPoint).length;
			if (distance < 3) {
				return {
					type: type,
					segment: segment
				};
			}
		}
	}
	return null;
}*/

var toolPan = new Tool();
toolPan.mouseStartPos = new Point();
toolPan.mode = 'pan';
toolPan.zoomFactor = 1.5;
toolPan.on({
	activate: function() {
	},
	mousedown: function(event) {
		this.mouseStartPos = event.point.subtract(paper.view.center);
		this.mode = '';
		if (event.modifiers.space) {
			if (event.modifiers.command) {
				this.mode = 'zoom';
			} else {
				this.mode = 'pan';
			}
		}
	},
	mouseup: function(event) {
		if (this.mode == 'zoom') {
			var delta = event.point.subtract(paper.view.center);
			if (event.modifiers.command && !event.modifiers.shift) {
				paper.view.zoom *= this.zoomFactor;
				paper.view.center = paper.view.center.add(delta.multiply((this.zoomFactor - 1) / this.zoomFactor));
			} else if (event.modifiers.command && event.modifiers.shift) {
				paper.view.zoom /= this.zoomFactor;
				paper.view.center = paper.view.center.subtract(delta.multiply(this.zoomFactor - 1));
			}
		}
//		paper.view.draw();
	},
	mousedrag: function(event) {
		if (this.mode == 'pan') {
			var pt = event.point.subtract(paper.view.center);
			var delta = this.mouseStartPos.subtract(pt);
			paper.view.scrollBy(delta);
			this.mouseStartPos = pt;
		}
//		paper.view.draw();
	}
});

var toolCreate = new Tool();
toolCreate.hoverShape = null;
toolCreate.clearHandles = false;
toolCreate.on({
	activate: function(event) {
		this.mode = this.type = this.currentSegment = null;
	},
	deactivate: function(event) {
		toolCreate.hoverShape.delete();		
	},
	mousedown: function(event) {
		if (this.currentSegment)
			this.currentSegment.selected = false;
//		this.mode = 
//		this.type = this.currentSegment = null;

		if (this.mode == 'add') {
			if (!path) {
				path = new Path();
				path.fillColor = {
					hue: 360 * Math.random(),
					saturation: 1,
					brightness: 1,
					alpha: 0.5
				};
			}
			this.currentSegment = path.add(event.point);
		}

		if (this.mode == 'close') {
			if (path)
				path.closed = true;
			this.clearHandles = true;
		}

		if (this.currentSegment)
			this.currentSegment.selected = true;

/*		if (path) {}
		var handle = event.item.hitTest(event.point, { segments: true, handles: true, tolerance: 4 });
		if (handle && handle.type !== 'segment')
			handle = null;

		var result = findHandle(event.point);
		if (result) {
			this.currentSegment = result.segment;
			this.type = result.type;
			if (path.segments.length > 1 && result.type == 'point'
					&& result.segment.index == 0) {
				this.mode = 'close';
				path.closed = true;
				path.selected = false;
				path = null;
			}
		}*/

/*		if (this.mode != 'close') {
			this.mode = this.currentSegment ? 'move' : 'add';
			if (!this.currentSegment)
				this.currentSegment = path.add(event.point);
			this.currentSegment.selected = true;
		}*/
//		paper.view.draw();
	},
	mouseup: function(event) {
		if (this.mode == 'close') {
			path.selected = false;
			path = null;
		}
		this.mode = null;
	},
	mousedrag: function(event) {
		if (this.mode == 'move' && this.type == 'segment') {
			this.currentSegment.point = event.point.clone();
		} else {
			if (this.clearHandles) {
				this.currentSegment.handleIn = new Point();
				this.currentSegment.handleOut = new Point();
				this.clearHandles = false;
			}
			var delta = event.delta.clone();
			if (this.type == 'handle-out' || this.mode == 'add' || this.mode == 'close')
				delta = delta.negate();
			this.currentSegment.handleIn = this.currentSegment.handleIn.add(delta);
			this.currentSegment.handleOut = this.currentSegment.handleOut.subtract(delta);
		}
//		paper.view.draw(); 
	},
	mousemove: function(event) {
		this.mode = 'add';
		this.currentSegment = null;
		if (path) {
			var result = path.hitTest(event.point, { segments: true, handles: true, tolerance: 4 });
			if (result) {
				if (this.hoverShape == null) {
					this.hoverShape = new Path.Circle(new Point(), 4);
					this.hoverShape.strokeColor = 'black';
					window.console.log("hoverShape="+this.hoverShape);
				}
				if (result.type == 'segment')
					this.hoverShape.setPosition(result.segment.point);
				else if (result.type == 'handle-in')
					this.hoverShape.setPosition(result.segment.point.add(result.segment.handleIn));
				else if (result.type == 'handle-out')
					this.hoverShape.setPosition(result.segment.point.add(result.segment.handleOut));

				this.mode = 'move';
				this.type = result.type;
				this.currentSegment = result.segment;

				if (path.segments.length > 1 && result.type == 'segment' && result.segment.index == 0) {
					this.mode = 'close';
/*					path.closed = true;
					path.selected = false;
					path = null;*/
				}

			} else {
				if (this.hoverShape) {
					this.hoverShape.remove();
					this.hoverShape = null;
				}
			}
		}
	}
});



$(document).ready(function() {
	var $canvas = $('#canvas');
	paper.setup($canvas[0]);

	var path1 = new Path.Circle(new Point(80, 50), 30);
	path1.strokeColor = 'black';

	toolCreate.activate();

	paper.view.draw();
});
