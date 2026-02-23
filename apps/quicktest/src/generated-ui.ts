import { 
  CreateStartUpPageContainer, 
  ListContainerProperty, 
  TextContainerProperty, 
  ImageContainerProperty,
  ListItemContainerProperty
} from '@evenrealities/even_hub_sdk';

const textContainer1 = new TextContainerProperty({
  xPosition: 20,
  yPosition: 20,
  width: 250,
  height: 40,
  containerID: 1,
  containerName: "text-1",
  content: "Generated page by editor",
  isEventCapture: 0
});

const listContainer1 = new ListContainerProperty({
  xPosition: 23,
  yPosition: 64,
  width: 450,
  height: 120,
  containerID: 2,
  containerName: "list-1",
  itemContainer: new ListItemContainerProperty({
      itemCount: 3,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [
        "First list item with a short label",
        "Second item with longer text to demonstrate text layout",
        "Third item with moderate length content here"
      ]
    }),
  isEventCapture: 1
});

const container = new CreateStartUpPageContainer({
  containerTotalNum: 2,
  listObject: [listContainer1],
  textObject: [textContainer1],
  imageObject: [],
});
