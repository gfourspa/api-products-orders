import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Business } from '../../business/entities/business.entity';
import { Language, OrderSource, OrderStatus } from '../../common/enums';
import { OrderItem } from '../entities/order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_name' })
  customerName!: string;

  @Column({ nullable: true })
  phone!: string;

  @Column()
  email!: string;

  @Column({ name: 'delivery_date', type: 'date' })
  deliveryDate!: string;

  @Column({ nullable: true })
  notes!: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total!: number;

  @Column({ type: 'enum', enum: Language, default: Language.ES })
  language!: Language;

  @Column({
    type: 'enum',
    enum: OrderSource,
    default: OrderSource.CUSTOMER,
  })
  source!: OrderSource;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  business!: Business;

  @Column({ name: 'business_id' })
  businessId!: string;

  @Column({ name: 'tracking_token', unique: true })
  trackingToken!: string;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items!: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
